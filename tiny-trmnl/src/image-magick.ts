import { execFile } from 'node:child_process';

/**
 * https://docs.trmnl.com/go/diy/imagemagick-guide
 */
export function convertImage(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      'magick',
      [
        'png:-',

        '-monochrome',
        '-colors',
        '2',

        // '-dither',
        // 'FloydSteinberg',
        // '-remap',
        // 'pattern:gray50',

        '-depth',
        '1',
        '-strip',
        'png:-',
      ],
      { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(error);
        resolve(stdout);
      },
    );

    if (!proc.stdin) {
      reject(new Error('Failed to open ImageMagick stdin'));
      return;
    }

    proc.stdin.end(input);
  });
}
