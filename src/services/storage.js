const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { AppError } = require("../lib/errors");

let cachedSupabaseClient = null;
let cachedSupabaseKey = "";

function sanitizeSupabaseStorageError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error.name,
    message: error.message,
    code: error.code || error.error,
    status: error.statusCode || error.status
  };
}

function logSupabaseStorageError(message, error, extra = {}) {
  console.error(message, {
    ...extra,
    error: sanitizeSupabaseStorageError(error)
  });
}

function isBucketAlreadyExistsError(error, bucketName) {
  if (!error) {
    return false;
  }

  const normalizedMessage = String(error.message || "").toLowerCase();
  const normalizedCode = String(error.code || error.error || "").toLowerCase();
  const normalizedBucketName = String(bucketName || "").toLowerCase();

  return (
    error.status === 409 ||
    error.statusCode === 409 ||
    normalizedCode.includes("duplicate") ||
    normalizedCode.includes("already_exists") ||
    normalizedCode.includes("already exists") ||
    normalizedMessage.includes("duplicate") ||
    normalizedMessage.includes("already exists") ||
    (normalizedBucketName && normalizedMessage.includes(normalizedBucketName))
  );
}

function isStorageObjectMissingError(error) {
  if (!error) {
    return false;
  }

  const normalizedMessage = String(error.message || "").toLowerCase();
  const normalizedCode = String(error.code || error.error || "").toLowerCase();

  return (
    error.status === 404 ||
    error.statusCode === 404 ||
    normalizedCode.includes("not_found") ||
    normalizedCode.includes("object_not_found") ||
    normalizedMessage.includes("not found") ||
    normalizedMessage.includes("no such file")
  );
}

function getSupabaseAdminClient(runtimeConfig) {
  if (runtimeConfig.supabaseAdminClient) {
    return runtimeConfig.supabaseAdminClient;
  }

  const cacheKey = `${runtimeConfig.supabaseUrl}::${runtimeConfig.supabaseServiceRoleKey}`;

  if (cachedSupabaseClient && cachedSupabaseKey === cacheKey) {
    return cachedSupabaseClient;
  }

  if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseServiceRoleKey) {
    throw new AppError(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem ser definidos para usar o storage Supabase.",
      500
    );
  }

  cachedSupabaseClient = createClient(
    runtimeConfig.supabaseUrl,
    runtimeConfig.supabaseServiceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
  cachedSupabaseKey = cacheKey;
  return cachedSupabaseClient;
}

function buildSafeFileName(extension) {
  return `${Date.now()}-${crypto.randomUUID()}${extension}`;
}

function getPublicBucketName(runtimeConfig) {
  return runtimeConfig.supabaseStorageBucket;
}

function getPrivateBucketName(runtimeConfig) {
  return runtimeConfig.supabasePrivateStorageBucket || runtimeConfig.supabaseStorageBucket;
}

function storeLocally(file, runtimeConfig, canonicalExtension) {
  const fileName = buildSafeFileName(canonicalExtension);
  const uploadsRoot = path.resolve(runtimeConfig.uploadDir);
  const targetPath = path.resolve(uploadsRoot, fileName);

  if (!targetPath.startsWith(`${uploadsRoot}${path.sep}`) && targetPath !== path.join(uploadsRoot, fileName)) {
    throw new AppError("Destino de upload inválido.", 400);
  }

  fs.writeFileSync(targetPath, file.buffer, { flag: "wx" });
  return `/uploads/${fileName}`;
}

// Raiz dos documentos privados. Por padrão, irmã de uploadDir — mesmo disco,
// fora do que express.static publica.
function getPrivateRoot(runtimeConfig) {
  if (runtimeConfig.privateUploadDir) {
    return path.resolve(runtimeConfig.privateUploadDir);
  }
  const uploadsRoot = path.resolve(runtimeConfig.uploadDir);
  return path.join(path.dirname(uploadsRoot), "private-documents");
}

function resolveInRoot(root, objectKey) {
  // Normaliza separadores do Windows e tira barras iniciais, para que a
  // checagem de contenção abaixo não seja contornável.
  const barraInvertida = String.fromCharCode(92);
  let normalizedKey = String(objectKey || "").split(barraInvertida).join("/");
  while (normalizedKey.startsWith("/")) {
    normalizedKey = normalizedKey.slice(1);
  }

  const targetPath = path.resolve(root, normalizedKey);

  if (!targetPath.startsWith(`${root}${path.sep}`) && targetPath !== root) {
    throw new AppError("Caminho de arquivo inválido.", 400);
  }

  return { normalizedKey, targetPath };
}

// Caminho de um documento privado, e o caminho legado dentro de uploadDir,
// onde os recibos emitidos antes desta separação ainda estão.
function resolvePrivateObjectPath(runtimeConfig, objectKey) {
  const privateRoot = getPrivateRoot(runtimeConfig);
  const { normalizedKey, targetPath } = resolveInRoot(privateRoot, objectKey);
  const legado = resolveInRoot(path.resolve(runtimeConfig.uploadDir), objectKey);

  return {
    privateRoot,
    normalizedKey,
    targetPath,
    legacyPath: legado.targetPath
  };
}

function resolveLocalObjectPath(runtimeConfig, objectKey) {
  const uploadsRoot = path.resolve(runtimeConfig.uploadDir);
  const normalizedKey = String(objectKey || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const targetPath = path.resolve(uploadsRoot, normalizedKey);

  if (!targetPath.startsWith(`${uploadsRoot}${path.sep}`) && targetPath !== uploadsRoot) {
    throw new AppError("Caminho de arquivo inválido.", 400);
  }

  return {
    uploadsRoot,
    normalizedKey,
    targetPath
  };
}

async function storeOnSupabase(file, runtimeConfig, canonicalExtension, detectedType) {
  const supabase = getSupabaseAdminClient(runtimeConfig);
  const objectPath = `site/${buildSafeFileName(canonicalExtension)}`;
  const bucketName = getPublicBucketName(runtimeConfig);

  const uploadResult = await supabase.storage
    .from(bucketName)
    .upload(objectPath, file.buffer, {
      cacheControl: "31536000",
      contentType: detectedType.mime,
      upsert: false
    });

  if (uploadResult.error) {
    logSupabaseStorageError("Falha no upload para o Supabase Storage.", uploadResult.error, {
      bucket: bucketName
    });
    throw new AppError("Falha ao salvar a imagem.", 500);
  }

  const publicUrlResult = supabase.storage
    .from(bucketName)
    .getPublicUrl(objectPath);

  return publicUrlResult.data.publicUrl;
}

function ensureLocalStorage(runtimeConfig) {
  fs.mkdirSync(runtimeConfig.uploadDir, { recursive: true });
  fs.mkdirSync(getPrivateRoot(runtimeConfig), { recursive: true });
}

async function ensureSupabaseStorage(runtimeConfig, options = {}) {
  const {
    allowSoftFailure = false,
    bucketName = getPublicBucketName(runtimeConfig),
    isPublic = true,
    allowedMimeTypes = runtimeConfig.allowedUploadMimeTypes,
    fileSizeLimit = runtimeConfig.maxUploadBytes,
    label = "bucket de arquivos"
  } = options;
  const supabase = getSupabaseAdminClient(runtimeConfig);
  const desiredMimeTypes = Array.from(new Set(allowedMimeTypes));
  const bucketsResult = await supabase.storage.listBuckets();

  if (bucketsResult.error) {
    logSupabaseStorageError(`Falha ao verificar ${label} no Supabase.`, bucketsResult.error, {
      bucket: bucketName
    });

    if (allowSoftFailure) {
      return false;
    }

    throw new AppError("Falha ao verificar o bucket de arquivos.", 500);
  }

  const exists = bucketsResult.data.some((bucket) => bucket.name === bucketName);

  if (exists) {
    const existingBucket = bucketsResult.data.find((bucket) => bucket.name === bucketName);
    const currentMimeTypes = Array.isArray(
      existingBucket?.allowed_mime_types || existingBucket?.allowedMimeTypes
    )
      ? existingBucket.allowed_mime_types || existingBucket.allowedMimeTypes
      : [];
    const needsUpdate =
      Boolean(existingBucket?.public) !== Boolean(isPublic) ||
      currentMimeTypes.length !== desiredMimeTypes.length ||
      desiredMimeTypes.some((mime) => !currentMimeTypes.includes(mime));

    if (needsUpdate && typeof supabase.storage.updateBucket === "function") {
      const updateResult = await supabase.storage.updateBucket(bucketName, {
        public: isPublic,
        allowedMimeTypes: desiredMimeTypes,
        fileSizeLimit
      });

      if (updateResult.error) {
        logSupabaseStorageError(`Falha ao atualizar ${label} do Supabase.`, updateResult.error, {
          bucket: bucketName
        });

        if (!allowSoftFailure) {
          throw new AppError("Falha ao preparar o bucket de arquivos.", 500);
        }

        return false;
      }
    }

    return;
  }

  const createResult = await supabase.storage.createBucket(bucketName, {
    public: isPublic,
    allowedMimeTypes: desiredMimeTypes,
    fileSizeLimit
  });

  if (createResult.error) {
    if (isBucketAlreadyExistsError(createResult.error, bucketName)) {
      return true;
    }

    logSupabaseStorageError(`Falha ao criar ${label} no Supabase.`, createResult.error, {
      bucket: bucketName
    });

    if (allowSoftFailure) {
      return false;
    }

    throw new AppError("Falha ao criar o bucket de arquivos.", 500);
  }

  return true;
}

async function ensureStorageReady(runtimeConfig, options = {}) {
  if (runtimeConfig.storageProvider === "supabase") {
    await ensureSupabaseStorage(runtimeConfig, {
      ...options,
      bucketName: getPublicBucketName(runtimeConfig),
      isPublic: true,
      allowedMimeTypes: runtimeConfig.allowedUploadMimeTypes,
      label: "o bucket público de imagens"
    });
    await ensureSupabaseStorage(runtimeConfig, {
      ...options,
      bucketName: getPrivateBucketName(runtimeConfig),
      isPublic: false,
      allowedMimeTypes: runtimeConfig.allowedDocumentMimeTypes || ["application/pdf"],
      label: "o bucket privado de documentos"
    });
    return;
  }

  ensureLocalStorage(runtimeConfig);
}

async function persistImage(file, runtimeConfig, canonicalExtension, detectedType) {
  if (runtimeConfig.storageProvider === "supabase") {
    return storeOnSupabase(file, runtimeConfig, canonicalExtension, detectedType);
  }

  return storeLocally(file, runtimeConfig, canonicalExtension);
}

async function persistPrivateDocument(buffer, runtimeConfig, options = {}) {
  const contentType = options.contentType || "application/pdf";
  const extension = options.extension || ".pdf";
  const folder = String(options.folder || "receipts")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/")
    .replace(/\.\./g, "")
    .replace(/\/+/g, "/");
  const fileName = buildSafeFileName(extension);
  const objectKey = `${folder}/${fileName}`;

  if (runtimeConfig.storageProvider === "supabase") {
    const supabase = getSupabaseAdminClient(runtimeConfig);
    const bucketName = getPrivateBucketName(runtimeConfig);
    await ensureSupabaseStorage(runtimeConfig, {
      allowSoftFailure: false,
      bucketName,
      isPublic: false,
      allowedMimeTypes: runtimeConfig.allowedDocumentMimeTypes || ["application/pdf"],
      label: "o bucket privado de documentos"
    });
    const uploadResult = await supabase.storage
      .from(bucketName)
      .upload(objectKey, buffer, {
        cacheControl: "3600",
        contentType,
        upsert: false
      });

    if (uploadResult.error) {
      logSupabaseStorageError("Falha ao salvar documento no Supabase Storage.", uploadResult.error, {
        bucket: bucketName,
        folder
      });
      throw new AppError("Falha ao salvar o documento.", 500);
    }

    return {
      storageProvider: "supabase",
      objectKey,
      contentType,
      sizeBytes: buffer.length
    };
  }

  const { targetPath } = resolvePrivateObjectPath(runtimeConfig, objectKey);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, buffer, { flag: "wx" });

  return {
    storageProvider: "local",
    objectKey,
    contentType,
    sizeBytes: buffer.length
  };
}

async function readPrivateDocument(objectKey, runtimeConfig, storageProvider = runtimeConfig.storageProvider) {
  if (storageProvider === "supabase") {
    const supabase = getSupabaseAdminClient(runtimeConfig);
    const privateBucketName = getPrivateBucketName(runtimeConfig);
    let downloadResult = await supabase.storage
      .from(privateBucketName)
      .download(objectKey);

    if (
      downloadResult.error &&
      isStorageObjectMissingError(downloadResult.error) &&
      privateBucketName !== getPublicBucketName(runtimeConfig)
    ) {
      downloadResult = await supabase.storage
        .from(getPublicBucketName(runtimeConfig))
        .download(objectKey);
    }

    if (downloadResult.error) {
      logSupabaseStorageError("Falha ao ler documento do Supabase Storage.", downloadResult.error, {
        bucket: privateBucketName,
        objectKey
      });
      throw new AppError("Falha ao ler o documento.", 500);
    }

    return Buffer.from(await downloadResult.data.arrayBuffer());
  }

  const { targetPath, legacyPath } = resolvePrivateObjectPath(runtimeConfig, objectKey);
  if (fs.existsSync(targetPath)) {
    return fs.readFileSync(targetPath);
  }

  // Recibos emitidos antes da separação de diretórios ainda estão dentro de
  // uploadDir. Continuam legíveis por aqui — mas só por esta rota autenticada.
  if (fs.existsSync(legacyPath)) {
    return fs.readFileSync(legacyPath);
  }

  throw new AppError("Documento não encontrado.", 404);
}

async function deletePrivateDocument(objectKey, runtimeConfig, storageProvider = runtimeConfig.storageProvider) {
  if (!objectKey) {
    return;
  }

  if (storageProvider === "supabase") {
    const supabase = getSupabaseAdminClient(runtimeConfig);
    const privateBucketName = getPrivateBucketName(runtimeConfig);
    const removeFromBucket = async (bucketName) =>
      supabase.storage
        .from(bucketName)
        .remove([objectKey]);

    let removeResult = await removeFromBucket(privateBucketName);

    if (
      removeResult.error &&
      isStorageObjectMissingError(removeResult.error) &&
      privateBucketName !== getPublicBucketName(runtimeConfig)
    ) {
      removeResult = await removeFromBucket(getPublicBucketName(runtimeConfig));
    }

    if (removeResult.error) {
      logSupabaseStorageError("Falha ao remover documento do Supabase Storage.", removeResult.error, {
        bucket: privateBucketName,
        objectKey
      });
    }

    return;
  }

  const { targetPath, legacyPath } = resolvePrivateObjectPath(runtimeConfig, objectKey);
  for (const caminho of [targetPath, legacyPath]) {
    if (fs.existsSync(caminho)) {
      fs.unlinkSync(caminho);
    }
  }
}

// Apaga uma imagem que este app guardou, a partir do valor gravado no
// conteúdo (caminho /uploads/... no modo local, URL pública no Supabase).
// Trocar a imagem de um bloco deixava o arquivo anterior para sempre no
// storage. É melhor esforço: falhar aqui não pode impedir o salvamento.
async function deleteStoredImage(value, runtimeConfig) {
  const valor = String(value || "").trim();
  if (!valor) {
    return { deleted: false };
  }

  try {
    if (valor.startsWith("/uploads/")) {
      const chave = valor.slice("/uploads/".length);
      const { targetPath } = resolveInRoot(path.resolve(runtimeConfig.uploadDir), chave);
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
        return { deleted: true };
      }
      return { deleted: false };
    }

    const bucket = getPublicBucketName(runtimeConfig);
    const marcador = `/object/public/${bucket}/`;
    const posicao = valor.indexOf(marcador);
    // Só mexemos no que é comprovadamente nosso: URL do bucket público deste
    // projeto. Qualquer outro endereço é deixado em paz.
    if (posicao < 0 || runtimeConfig.storageProvider !== "supabase") {
      return { deleted: false };
    }

    const objectKey = decodeURIComponent(valor.slice(posicao + marcador.length));
    if (!objectKey) {
      return { deleted: false };
    }

    const supabase = getSupabaseAdminClient(runtimeConfig);
    const resultado = await supabase.storage.from(bucket).remove([objectKey]);
    if (resultado.error && !isStorageObjectMissingError(resultado.error)) {
      logSupabaseStorageError("Falha ao remover imagem substituída.", resultado.error, {
        bucket,
        objectKey
      });
      return { deleted: false };
    }

    return { deleted: true };
  } catch (error) {
    return { deleted: false };
  }
}

module.exports = {
  ensureStorageReady,
  persistImage,
  persistPrivateDocument,
  readPrivateDocument,
  deletePrivateDocument,
  deleteStoredImage
};
