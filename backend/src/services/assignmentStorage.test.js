const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_FILE_BYTES,
  identifySupportedFile,
  putPrivateFile,
  safeDisplayName,
} = require('./assignmentStorage');

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lKQAAAAASUVORK5CYII=',
  'base64'
);
const minimalDocx = Buffer.from(
  'UEsDBAoAAAAAABFUel2T+DSMlwAAAJcAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDxUeXBlcz48T3ZlcnJpZGUgUGFydE5hbWU9Ii93b3JkL2RvY3VtZW50LnhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC53b3JkcHJvY2Vzc2luZ21sLmRvY3VtZW50Lm1haW4reG1sIi8+PC9UeXBlcz5QSwMECgAAAAAAEVR6XQAAAAAAAAAAAAAAAAUAAAB3b3JkL1BLAwQKAAAAAAARVHpdX1vRTAsAAAALAAAAEQAAAHdvcmQvZG9jdW1lbnQueG1sPGRvY3VtZW50Lz5QSwECFAAKAAAAAAARVHpdk/g0jJcAAACXAAAAEwAAAAAAAAAAAAAAAAAAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAAoAAAAAABFUel0AAAAAAAAAAAAAAAAFAAAAAAAAAAAAEAAAAMgAAAB3b3JkL1BLAQIUAAoAAAAAABFUel1fW9FMCwAAAAsAAAARAAAAAAAAAAAAAAAAAOsAAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALMAAAAlAQAAAAA=',
  'base64'
);
const genericZip = Buffer.from(
  'UEsDBAoAAAAAABFUel3OTNbeEwAAABMAAAALAAAAcGF5bG9hZC5iaW5ub3QgYSB3b3JkIGRvY3VtZW50UEsBAhQACgAAAAAAEVR6Xc5M1t4TAAAAEwAAAAsAAAAAAAAAAAAAAAAAAAAAAHBheWxvYWQuYmluUEsFBgAAAAABAAEAOQAAADwAAAAAAA==',
  'base64'
);

test('uploads require matching allowed extensions and detected file signatures', async () => {
  assert.equal((await identifySupportedFile({ originalname: 'homework.png', buffer: onePixelPng })).contentType, 'image/png');
  await assert.rejects(
    identifySupportedFile({ originalname: 'homework.exe', buffer: onePixelPng }),
    { status: 415 }
  );
  await assert.rejects(
    identifySupportedFile({ originalname: 'homework.jpg', buffer: onePixelPng }),
    { status: 415 }
  );
});

test('uploads reject empty and oversized files and sanitize displayed names', async () => {
  await assert.rejects(identifySupportedFile({ originalname: 'empty.png', buffer: Buffer.alloc(0) }), { status: 400 });
  await assert.rejects(identifySupportedFile({ originalname: 'large.png', buffer: Buffer.alloc(MAX_FILE_BYTES + 1) }), { status: 413 });
  assert.equal(safeDisplayName('../../answer<1>.png'), 'answer_1_.png');
});

test('DOCX uploads must have an OpenXML Word signature rather than a generic ZIP signature', async () => {
  assert.equal(
    (await identifySupportedFile({ originalname: 'homework.docx', buffer: minimalDocx })).contentType,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  await assert.rejects(
    identifySupportedFile({ originalname: 'homework.docx', buffer: genericZip }),
    { status: 415 }
  );
});

test('uploads fail with a controlled unavailable-storage error when no private bucket is configured', async () => {
  const previousBucket = process.env.LEARNING_FILES_BUCKET;
  delete process.env.LEARNING_FILES_BUCKET;
  try {
    await assert.rejects(
      putPrivateFile({
        schoolId: 1,
        assignmentId: 2,
        kind: 'resource',
        file: { originalname: 'homework.png', buffer: onePixelPng },
      }),
      { status: 503, message: /Private learning-file storage is not configured/ }
    );
  } finally {
    if (previousBucket === undefined) delete process.env.LEARNING_FILES_BUCKET;
    else process.env.LEARNING_FILES_BUCKET = previousBucket;
  }
});
