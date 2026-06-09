import argparse
import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def read_image(path: Path) -> np.ndarray:
    data = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
      raise ValueError(f"Could not read image: {path}")
    return image


def write_png(path: Path, rgba: np.ndarray | Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = rgba if isinstance(rgba, Image.Image) else Image.fromarray(rgba, mode="RGBA")
    image.save(path, optimize=True)


def resize_for_work(image: np.ndarray, max_side: int) -> tuple[np.ndarray, float]:
    height, width = image.shape[:2]
    scale = min(1.0, max_side / max(height, width))
    if scale == 1.0:
        return image.copy(), 1.0
    resized = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    return resized, scale


def largest_component(mask: np.ndarray) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if count <= 1:
        return mask
    largest = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    return labels == largest


def make_alpha(image: np.ndarray, max_side: int, iterations: int, rect_margin: float) -> np.ndarray:
    work, scale = resize_for_work(image, max_side)
    height, width = work.shape[:2]
    margin_x = max(2, round(width * rect_margin))
    margin_y = max(2, round(height * rect_margin))
    rect = (margin_x, margin_y, width - 2 * margin_x, height - 2 * margin_y)

    mask = np.zeros((height, width), np.uint8)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    cv2.grabCut(work, mask, rect, bgd_model, fgd_model, iterations, cv2.GC_INIT_WITH_RECT)

    foreground = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8), iterations=2)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)
    foreground = largest_component(foreground > 0).astype(np.uint8) * 255

    if scale != 1.0:
        foreground = cv2.resize(foreground, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_LINEAR)

    foreground = cv2.GaussianBlur(foreground, (0, 0), 1.2)
    alpha = np.where(foreground > 235, 255, np.where(foreground < 8, 0, foreground)).astype(np.uint8)
    return alpha


def crop_to_alpha(rgba: np.ndarray, padding: int) -> np.ndarray:
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0 or len(ys) == 0:
        return rgba
    left = max(0, xs.min() - padding)
    right = min(rgba.shape[1], xs.max() + padding + 1)
    top = max(0, ys.min() - padding)
    bottom = min(rgba.shape[0], ys.max() + padding + 1)
    return rgba[top:bottom, left:right]


def cutout_grabcut(source: Path, output_dir: Path, args: argparse.Namespace) -> Path:
    image = read_image(source)
    alpha = make_alpha(image, args.max_work_side, args.iterations, args.rect_margin)
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    rgba = np.dstack([rgb, alpha])
    rgba = crop_to_alpha(rgba, args.padding)

    if args.max_output_side and max(rgba.shape[:2]) > args.max_output_side:
        scale = args.max_output_side / max(rgba.shape[:2])
        size = (round(rgba.shape[1] * scale), round(rgba.shape[0] * scale))
        rgba = np.array(Image.fromarray(rgba, mode="RGBA").resize(size, Image.Resampling.LANCZOS))

    target = output_dir / f"{source.stem}-cutout.png"
    write_png(target, rgba)
    return target


def crop_pil_to_alpha(image: Image.Image, padding: int) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 8 else 0).getbbox()
    if bbox is None:
        return rgba
    left, top, right, bottom = bbox
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(rgba.width, right + padding)
    bottom = min(rgba.height, bottom + padding)
    return rgba.crop((left, top, right, bottom))


def resize_pil(image: Image.Image, max_side: int | None) -> Image.Image:
    if not max_side or max(image.size) <= max_side:
        return image
    scale = max_side / max(image.size)
    size = (round(image.width * scale), round(image.height * scale))
    return image.resize(size, Image.Resampling.LANCZOS)


def fit_pil(image: Image.Image, max_side: int | None) -> tuple[Image.Image, float]:
    if not max_side or max(image.size) <= max_side:
        return image.copy(), 1.0
    scale = max_side / max(image.size)
    size = (round(image.width * scale), round(image.height * scale))
    return image.resize(size, Image.Resampling.LANCZOS), scale


def cutout_rembg(source: Path, output_dir: Path, args: argparse.Namespace) -> Path:
    cache_dir = Path(args.model_cache).resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("U2NET_HOME", str(cache_dir))
    os.environ.setdefault("XDG_DATA_HOME", str(cache_dir))

    from rembg import new_session, remove

    session = getattr(args, "session", None) or new_session(args.model)
    with Image.open(source) as input_image:
        original = input_image.convert("RGB")
        work, scale = fit_pil(original, args.max_model_side)
        cutout = remove(work, session=session, alpha_matting=args.alpha_matting).convert("RGBA")
        alpha = cutout.getchannel("A")
        if scale != 1.0:
            alpha = alpha.resize(original.size, Image.Resampling.BILINEAR)
        result = original.convert("RGBA")
        result.putalpha(alpha)

    result = crop_pil_to_alpha(result, args.padding)
    result = resize_pil(result, args.max_output_side)

    target = output_dir / f"{source.stem}-cutout.png"
    write_png(target, result)
    return target


def normalize_mask(mask: np.ndarray) -> np.ndarray:
    mask = mask.astype(np.float32)
    min_value = float(mask.min())
    max_value = float(mask.max())
    if max_value - min_value < 1e-6:
        return np.zeros_like(mask, dtype=np.uint8)
    mask = (mask - min_value) / (max_value - min_value)
    return np.clip(mask * 255, 0, 255).astype(np.uint8)


def cutout_onnx(source: Path, output_dir: Path, args: argparse.Namespace) -> Path:
    import onnxruntime as ort

    model_path = Path(args.onnx_model)
    if not model_path.exists():
        model_path = Path(args.model_cache) / f"{args.model}.onnx"
    if not model_path.exists():
        raise FileNotFoundError(f"ONNX model not found: {model_path}")

    image = Image.open(source).convert("RGB")
    model_size = args.onnx_size
    work = image.resize((model_size, model_size), Image.Resampling.LANCZOS)
    arr = np.asarray(work).astype(np.float32) / 255.0
    arr = (arr - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
    arr = np.transpose(arr, (2, 0, 1))[None, :, :, :]

    session = getattr(args, "onnx_session", None)
    if session is None:
        session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    output = session.run(None, {input_name: arr})[0]
    mask = np.squeeze(output)
    alpha = Image.fromarray(normalize_mask(mask), mode="L").resize(image.size, Image.Resampling.BILINEAR)

    rgba = image.convert("RGBA")
    rgba.putalpha(alpha)
    rgba = crop_pil_to_alpha(rgba, args.padding)
    rgba = resize_pil(rgba, args.max_output_side)

    target = output_dir / f"{source.stem}-cutout.png"
    write_png(target, rgba)
    return target


def cutout_file(source: Path, output_dir: Path, args: argparse.Namespace) -> Path:
    if args.method == "grabcut":
        return cutout_grabcut(source, output_dir, args)
    if args.method == "onnx":
        return cutout_onnx(source, output_dir, args)
    return cutout_rembg(source, output_dir, args)


def main() -> int:
    parser = argparse.ArgumentParser(description="Create transparent PNG cutouts for desktop pet photos.")
    parser.add_argument("--input", default="assets/pet", type=Path, help="Input directory or image file.")
    parser.add_argument("--out", default="assets/pet-cutouts", type=Path, help="Output directory.")
    parser.add_argument("--method", choices=["onnx", "rembg", "grabcut"], default="onnx", help="Cutout method.")
    parser.add_argument("--model", default="u2netp", help="rembg model name.")
    parser.add_argument("--model-cache", default=".model_cache/rembg", type=Path, help="Local model cache directory.")
    parser.add_argument("--onnx-model", default=".model_cache/rembg/u2netp.onnx", type=Path, help="Local ONNX model path.")
    parser.add_argument("--onnx-size", default=320, type=int, help="Square input size for direct ONNX inference.")
    parser.add_argument("--max-model-side", default=1280, type=int, help="Max side sent to the rembg model.")
    parser.add_argument("--alpha-matting", action="store_true", help="Enable rembg alpha matting.")
    parser.add_argument("--max-work-side", default=1200, type=int, help="Max side used during GrabCut.")
    parser.add_argument("--max-output-side", default=900, type=int, help="Max side of saved cutout.")
    parser.add_argument("--iterations", default=6, type=int, help="GrabCut iterations.")
    parser.add_argument("--rect-margin", default=0.06, type=float, help="Initial background margin ratio.")
    parser.add_argument("--padding", default=24, type=int, help="Transparent padding after cropping.")
    args = parser.parse_args()

    source = args.input
    if source.is_dir():
        files = sorted(path for path in source.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS)
    else:
        files = [source]

    if not files:
        print(f"No images found in {source}")
        return 1

    if args.method == "rembg":
        cache_dir = Path(args.model_cache).resolve()
        cache_dir.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("U2NET_HOME", str(cache_dir))
        os.environ.setdefault("XDG_DATA_HOME", str(cache_dir))
        from rembg import new_session

        args.session = new_session(args.model)
    elif args.method == "onnx":
        import onnxruntime as ort

        model_path = Path(args.onnx_model)
        if not model_path.exists():
            model_path = Path(args.model_cache) / f"{args.model}.onnx"
        args.onnx_session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])

    for file in files:
        target = cutout_file(file, args.out, args)
        print(f"{file} -> {target}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
