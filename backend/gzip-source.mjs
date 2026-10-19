import { ZStream, zlibInflateInit2, zlibInflate, zlibInflateEnd, Z_FINISH, Z_OK, Z_STREAM_END } from 'pako';

export function inflateSingleGzip(input, limit) {
  const stream = new ZStream();
  if (zlibInflateInit2(stream, 31) !== Z_OK) throw new Error('gzip initialization failed');
  try {
    stream.input = input; stream.next_in = 0; stream.avail_in = input.length;
    stream.output = new Uint8Array(limit + 1); stream.next_out = 0; stream.avail_out = limit + 1;
    const status = zlibInflate(stream, Z_FINISH);
    if (status !== Z_STREAM_END || stream.avail_in !== 0 || stream.total_out > limit) throw new Error('gzip invalid, concatenated or oversized');
    return stream.output.slice(0, stream.total_out);
  } finally { zlibInflateEnd(stream); }
}
