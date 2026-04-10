from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
BANNER_PATH = ROOT / "banner-cpu-footprint.bmp"
DIALOG_PATH = ROOT / "dialog-cpu-footprint.bmp"


def load_font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def draw_wrapped_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    *,
    position: tuple[int, int],
    font: ImageFont.ImageFont,
    fill: tuple[int, int, int],
    max_width: int,
    line_height: int,
) -> int:
    x, y = position
    words = text.split()
    line = ""
    for word in words:
        candidate = word if not line else f"{line} {word}"
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if bbox[2] - bbox[0] <= max_width:
            line = candidate
            continue
        draw.text((x, y), line, font=font, fill=fill)
        y += line_height
        line = word
    if line:
        draw.text((x, y), line, font=font, fill=fill)
        y += line_height
    return y


def build_banner() -> None:
    image = Image.new("RGB", (493, 58), "#f7fafc")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 493, 58), fill="#f7fafc")
    draw.rectangle((0, 0, 16, 58), fill="#174ea6")
    draw.rectangle((16, 0, 493, 10), fill="#dbeafe")

    title_font = load_font(20, bold=True)
    body_font = load_font(14)
    draw.text((28, 13), "K-ERA Desktop CPU", font=title_font, fill="#0f172a")
    draw.text((255, 18), "About 2.3 GB total after first launch", font=body_font, fill="#334155")

    image.save(BANNER_PATH, format="BMP")


def build_dialog() -> None:
    image = Image.new("RGB", (493, 312), "#f8fafc")
    draw = ImageDraw.Draw(image)

    draw.rectangle((0, 0, 312, 312), fill="#f8fafc")
    draw.rectangle((312, 0, 493, 312), fill="#e8f0fe")
    draw.rectangle((0, 0, 493, 14), fill="#174ea6")
    draw.rectangle((24, 34, 288, 278), outline="#d0d7e2", width=1, fill="#ffffff")
    draw.rounded_rectangle((336, 34, 469, 86), radius=16, fill="#174ea6")
    draw.rounded_rectangle((336, 100, 469, 152), radius=16, fill="#ffffff")
    draw.rounded_rectangle((336, 166, 469, 218), radius=16, fill="#ffffff")
    draw.rounded_rectangle((336, 232, 469, 278), radius=16, fill="#ffffff")

    title_font = load_font(22, bold=True)
    subtitle_font = load_font(15, bold=True)
    body_font = load_font(14)
    small_font = load_font(12)

    draw.text((42, 52), "Disk space before install", font=title_font, fill="#0f172a")
    draw.text((42, 82), "설치 전 디스크 공간 안내", font=subtitle_font, fill="#174ea6")

    y = 118
    y = draw_wrapped_text(
        draw,
        "This CPU build uses about 2.3 GB after the first launch.",
        position=(42, y),
        font=body_font,
        fill=(15, 23, 42),
        max_width=230,
        line_height=20,
    )
    y = draw_wrapped_text(
        draw,
        "설치 파일만 보면 약 1.0 GB이지만, 첫 실행 때 Python runtime이 추가로 풀립니다.",
        position=(42, y + 8),
        font=body_font,
        fill=(51, 65, 85),
        max_width=230,
        line_height=20,
    )
    y = draw_wrapped_text(
        draw,
        "Keep extra free space on the AppData drive where %LOCALAPPDATA%\\KERA\\runtime will be created.",
        position=(42, y + 10),
        font=small_font,
        fill=(71, 85, 105),
        max_width=230,
        line_height=18,
    )

    draw.text((352, 52), "Total", font=small_font, fill="#dbeafe")
    draw.text((352, 70), "2.3 GB", font=load_font(24, bold=True), fill="#ffffff")

    draw.text((352, 114), "Installer", font=small_font, fill="#64748b")
    draw.text((352, 132), "1.0 GB", font=load_font(22, bold=True), fill="#0f172a")

    draw.text((352, 180), "First launch", font=small_font, fill="#64748b")
    draw.text((352, 198), "1.3 GB runtime", font=load_font(18, bold=True), fill="#0f172a")

    draw.text((352, 246), "Runtime path", font=small_font, fill="#64748b")
    draw.text((352, 264), "%LOCALAPPDATA%\\KERA\\runtime", font=load_font(11), fill="#0f172a")

    image.save(DIALOG_PATH, format="BMP")


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    build_banner()
    build_dialog()


if __name__ == "__main__":
    main()
