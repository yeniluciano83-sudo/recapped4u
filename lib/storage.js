// Cloudflare R2 (S3-compatible) storage helper.
// R2 has zero egress fees, which matters here since clients will be
// downloading full galleries/videos repeatedly during their retention
// window (length varies by tier -- see GALLERY_EXPIRY_MONTHS/DAYS in
// scripts/auto-recap.js).

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;

export async function uploadFile(key, buffer, contentType) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return key;
}

export async function getSignedDownloadUrl(key, expiresInSeconds = 3600, downloadFilename = null) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    // Without this, the URL is cross-origin from the app (R2's own domain),
    // and browsers ignore an <a download> attribute on cross-origin links
    // that don't set Content-Disposition themselves -- the click silently
    // does nothing. Setting it here makes R2 serve the header directly.
    ...(downloadFilename ? { ResponseContentDisposition: `attachment; filename="${downloadFilename}"` } : {}),
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

export async function deleteFile(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// Deletes every object under a key prefix. Used to sweep the
// deliverable/<id>/_render/ scratch area (parked title cards + in-flight
// chunk files) when a render finishes, or is abandoned (booking cancelled),
// or its gallery is purged -- see scripts/poll-and-recap.js. Paginates and
// batch-deletes 1000 at a time; a no-op if the prefix is already empty.
export async function deleteByPrefix(prefix) {
  let continuationToken;
  let deleted = 0;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: continuationToken })
    );
    const objects = (listed.Contents || []).map((o) => ({ Key: o.Key }));
    if (objects.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objects, Quiet: true } }));
      deleted += objects.length;
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
  return deleted;
}

// Lets a guest's browser PUT a photo straight to R2, bypassing our own
// Next.js function entirely -- see app/api/events/[eventId]/upload/presign
// /route.js. The client's PUT must send the exact same Content-Type header
// used here, or R2 rejects it with SignatureDoesNotMatch.
export async function getSignedUploadUrl(key, contentType, expiresInSeconds = 300) {
  const command = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

// Confirms a presigned direct-to-R2 upload actually landed, and how big it
// really is -- a presigned PUT URL can't cryptographically constrain the
// uploaded size the way an S3 POST policy would, so the size declared at
// presign time is trusted-but-unverified until this re-checks the real
// object. Returns null if the object doesn't exist (the PUT never
// completed, or hasn't propagated yet) -- the caller treats that as
// retryable, not a hard failure.
export async function getObjectSize(key) {
  try {
    const res = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return res.ContentLength ?? null;
  } catch (err) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

// Raw object body as a Node Readable, for piping straight into another
// stream (e.g. a zip archive) instead of buffering the whole file in memory
// first -- see app/api/gallery/[bookingId]/download-all/route.js, the only
// caller that needs this rather than a signed URL.
export async function getFileStream(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return res.Body;
}

// Builds a consistent storage path: raw guest uploads vs. final deliverables
export function buildStorageKey({ bookingId, kind, filename }) {
  // kind: "raw" | "deliverable"
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${kind}/${bookingId}/${Date.now()}_${safeName}`;
}
