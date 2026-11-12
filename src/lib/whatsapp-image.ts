import { z } from "zod";

export const prefixoImagemWhatsapp = "whatsapp:image:v1\n";
export const imagemWhatsappSchema = z.object({
  media: z.string().max(4 * Math.ceil(5 * 1024 * 1024 / 3)).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  mimetype: z.enum(["image/jpeg", "image/png"]),
}).refine(({ media, mimetype }) => {
  const bytes = Buffer.from(media, "base64");
  return bytes.length > 0 && bytes.length <= 5 * 1024 * 1024 &&
    bytes.toString("base64") === media && (mimetype === "image/png"
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255);
}, "Imagem inválida ou acima de 5 MiB.");

export const envelopeImagemWhatsappSchema = z.object({
  media: z.string(), mimetype: z.enum(["image/jpeg", "image/png"]), caption: z.string().max(8_000),
}).superRefine((v, ctx) => {
  if (!imagemWhatsappSchema.safeParse(v).success) ctx.addIssue({ code: "custom", message: "Imagem inválida." });
});
