const crypto = require('crypto');
const path = require('path');
const { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { fileTypeFromBuffer } = require('file-type');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 5;
const ALLOWED_TYPES = {
  '.pdf': ['application/pdf'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.doc': ['application/x-cfb', 'application/vnd.ms-office'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};

let client;

const getBucket = () => process.env.LEARNING_FILES_BUCKET?.trim();

const getClient = () => {
  if (!getBucket()) {
    const error = new Error('Private learning-file storage is not configured. Contact the school administrator.');
    error.status = 503;
    error.publicMessage = 'Private learning-file storage is not configured. Contact the school administrator.';
    throw error;
  }
  if (!client) {
    const endpoint = process.env.LEARNING_FILES_ENDPOINT?.trim();
    client = new S3Client({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
      endpoint: endpoint || undefined,
      forcePathStyle: Boolean(endpoint),
    });
  }
  return client;
};

const identifySupportedFile = async (file) => {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw Object.assign(new Error('Choose a non-empty file.'), { status: 400 });
  }
  if (file.buffer.length > MAX_FILE_BYTES) {
    throw Object.assign(new Error('Each file must be 10 MB or smaller.'), { status: 413 });
  }
  const extension = path.extname(file.originalname || '').toLowerCase();
  const detected = await fileTypeFromBuffer(file.buffer);
  if (!ALLOWED_TYPES[extension] || !detected || !ALLOWED_TYPES[extension].includes(detected.mime)) {
    throw Object.assign(new Error('Only matching PDF, DOC, DOCX, JPG, JPEG, and PNG files are allowed.'), { status: 415 });
  }
  return { extension, contentType: detected.mime };
};

const safeDisplayName = (name) => {
  const basename = path.basename(String(name || 'upload'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim()
    .slice(0, 180);
  return basename || 'upload';
};

const putPrivateFile = async ({ schoolId, assignmentId, resource = 'assignments', kind, file }) => {
  const { contentType } = await identifySupportedFile(file);
  const key = `school/${schoolId}/${resource}/${assignmentId}/${kind}/${crypto.randomUUID()}`;
  await getClient().send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: file.buffer,
    ContentLength: file.buffer.length,
    ContentType: contentType,
    CacheControl: 'private, no-store, max-age=0',
    ServerSideEncryption: process.env.LEARNING_FILES_SSE || undefined,
  }));
  return {
    storage_key: key,
    original_name: safeDisplayName(file.originalname),
    content_type: contentType,
    file_size: file.buffer.length,
  };
};

const getPrivateFile = (storageKey) => getClient().send(new GetObjectCommand({
  Bucket: getBucket(),
  Key: storageKey,
}));

const deletePrivateFile = (storageKey) => getClient().send(new DeleteObjectCommand({
  Bucket: getBucket(),
  Key: storageKey,
}));

module.exports = {
  MAX_FILE_BYTES,
  MAX_FILES_PER_UPLOAD,
  identifySupportedFile,
  safeDisplayName,
  putPrivateFile,
  getPrivateFile,
  deletePrivateFile,
};
