const { storeUploadedImage } = require("../middleware/upload");
const { appendAuditLog } = require("../services/audit");
const { getRepositories } = require("./dependencies");
const { asyncRoute } = require("./shared");

function register(app, { runtimeConfig, requireAdminApi, uploadMiddleware }) {
  app.post(
    "/api/admin/uploads",
    requireAdminApi,
    uploadMiddleware.single("image"),
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const url = await storeUploadedImage(req.file, runtimeConfig);
      await appendAuditLog(repositories, req, {
        action: "image_uploaded",
        entityType: "image_upload",
        entityId: req.file?.originalname || "",
        summary: "Imagem enviada para o sistema.",
        metadata: {
          mimeType: req.file?.mimetype || "",
          sizeBytes: Number(req.file?.size || 0)
        }
      });
      res.json({
        ok: true,
        data: { url }
      });
    })
  );
}

module.exports = {
  register
};
