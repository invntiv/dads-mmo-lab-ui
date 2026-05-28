"""
cur2png.py — convert 32-bit CUR (Windows cursor) files to RGBA PNG.

WebKitGTK (Tauri's webview on Linux) doesn't decode .cur, so the
warcraftcn cursor pack has to ship as PNG for the `cursor: url(...)`
CSS to actually swap the pointer. Pure stdlib so no pip install on the
SteamOS host. Handles only the single-image, 32×32, 32-bit case which
is what warcraftcn's pack uses; would need work to handle multi-image
or palette-indexed cursors.

Usage: python3 cur2png.py <input.cur> <output.png>
"""
import struct
import sys
import zlib


def parse_cur(data: bytes):
    # ICONDIR (6 bytes): reserved, type=2 (cursor), count
    _, kind, count = struct.unpack_from("<HHH", data, 0)
    assert kind == 2, f"not a CUR file (type={kind})"
    assert count >= 1, "no images in CUR"
    # First ICONDIRENTRY (16 bytes): width, height, colors, reserved,
    # hotspotX, hotspotY, byteCount, byteOffset
    w_raw, h_raw, _colors, _res, hotspot_x, hotspot_y, size, offset = (
        struct.unpack_from("<BBBBHHII", data, 6)
    )
    width = w_raw or 256  # 0 = 256 in the ICONDIRENTRY format
    height = h_raw or 256
    # Bitmap section: 40-byte BITMAPINFOHEADER, then pixel data.
    # CUR's "height" field in the DIB header is doubled (XOR mask +
    # AND mask); the actual image is the top half.
    bm = data[offset : offset + size]
    (
        _bm_size, _w, _h, _planes, bit_count,
        _compression, _image_size, _xppm, _yppm, _clr_used, _clr_imp,
    ) = struct.unpack_from("<IiiHHIIiiII", bm, 0)
    assert bit_count in (24, 32), f"unsupported bit depth: {bit_count}"
    pixel_start = 40
    # 24-bit DIB rows are padded to a 4-byte boundary. 32-bit rows are
    # already aligned (4 bytes per pixel × N pixels). AND mask rows are
    # also 4-byte aligned regardless of width.
    src_row = ((width * bit_count + 31) // 32) * 4
    pixel_bytes = src_row * height
    pixel_data = bm[pixel_start : pixel_start + pixel_bytes]
    # AND mask: 1 bit per pixel, MSB-first. Bit set = pixel is
    # transparent. Only used for 24-bit (32-bit cursors already carry
    # alpha in the pixel data).
    mask_row = ((width + 31) // 32) * 4
    mask_data = bm[pixel_start + pixel_bytes : pixel_start + pixel_bytes + mask_row * height]
    rows = []
    out_row_bytes = width * 4
    for y in range(height):
        # Bottom-up in DIB → top-down in PNG.
        src_y = height - 1 - y
        row = bytearray(out_row_bytes)
        if bit_count == 32:
            src = pixel_data[src_y * src_row : src_y * src_row + width * 4]
            for x in range(width):
                b, g, r, a = src[x * 4 : x * 4 + 4]
                row[x * 4 : x * 4 + 4] = bytes((r, g, b, a))
        else:  # 24-bit + AND mask
            src = pixel_data[src_y * src_row : src_y * src_row + width * 3]
            mask = mask_data[src_y * mask_row : src_y * mask_row + mask_row]
            for x in range(width):
                b, g, r = src[x * 3 : x * 3 + 3]
                # Bit 7 = leftmost pixel in each byte (MSB-first).
                bit = (mask[x // 8] >> (7 - x % 8)) & 1
                a = 0 if bit else 255
                row[x * 4 : x * 4 + 4] = bytes((r, g, b, a))
        rows.append(bytes(row))
    return width, height, hotspot_x, hotspot_y, b"".join(rows)


def write_png(path: str, width: int, height: int, rgba: bytes):
    # PNG signature
    sig = b"\x89PNG\r\n\x1a\n"

    def chunk(tag: bytes, body: bytes) -> bytes:
        return (
            struct.pack(">I", len(body))
            + tag
            + body
            + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
        )

    # IHDR: 8-bit RGBA, no interlace
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    # IDAT: each scanline gets a 1-byte filter prefix (0 = none), then
    # zlib-compress the whole thing.
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(rgba[y * width * 4 : (y + 1) * width * 4])
    idat = zlib.compress(bytes(raw), 9)
    out = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(out)


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: cur2png.py <in.cur> <out.png>")
    src, dst = sys.argv[1], sys.argv[2]
    data = open(src, "rb").read()
    w, h, hx, hy, rgba = parse_cur(data)
    write_png(dst, w, h, rgba)
    print(f"{src} → {dst}  ({w}×{h}, hotspot {hx},{hy})")


if __name__ == "__main__":
    main()
