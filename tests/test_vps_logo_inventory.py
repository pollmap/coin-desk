"""Release logo validation rejects damaged images and mismatched identities."""
import pathlib
import struct
import sys
import unittest
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from logo_inventory import png_dimensions, validate_logos


def chunk(tag, body):
    return struct.pack('>I', len(body)) + tag + body + struct.pack('>I', zlib.crc32(tag + body))


class LogoInventory(unittest.TestCase):
    def test_real_release_has_one_verified_image_for_every_identity(self):
        result = validate_logos(ROOT)
        self.assertEqual(result['assets'], 150)
        self.assertEqual(result['distinctImages'], 150)
        self.assertLess(result['bytes'], 3 * 1024 * 1024)

    def test_crc_failure_is_rejected(self):
        image = bytearray((ROOT / 'public/coin-logos/btc.png').read_bytes())
        image[20] ^= 1
        with self.assertRaisesRegex(AssertionError, 'CRC'):
            png_dimensions(image)

    def test_truncation_and_trailing_bytes_are_rejected(self):
        image = (ROOT / 'public/coin-logos/btc.png').read_bytes()
        for body in [image[:-4], image + b'payload']:
            with self.assertRaises(AssertionError):
                png_dimensions(body)

    def test_oversized_dimensions_are_rejected(self):
        body = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 99999, 32, 8, 6, 0, 0, 0)) + chunk(b'IEND', b'')
        with self.assertRaisesRegex(AssertionError, 'dimensions'):
            png_dimensions(body)
