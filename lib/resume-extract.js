/**
 * 从上传的简历文件提取纯文本（在 popup 中运行）
 * 支持：txt/md/csv、docx、pdf；图片返回 data URL 供多模态解析。
 */

const MAX_TEXT_CHARS = 28000;

/**
 * @param {File} file
 * @returns {Promise<{ kind: 'text'|'image', text?: string, dataUrl?: string, mimeType?: string, fileName: string }>}
 */
async function extractResumeContent(file) {
  const name = file.name || "resume";
  const lower = name.toLowerCase();
  const mime = file.type || "";

  if (
    mime.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|bmp)$/i.test(lower)
  ) {
    const dataUrl = await readAsDataURL(file);
    return { kind: "image", dataUrl, mimeType: mime || "image/png", fileName: name };
  }

  if (/\.docx$/i.test(lower) || mime.includes("wordprocessingml")) {
    const text = await extractDocxText(await file.arrayBuffer());
    return { kind: "text", text: clipText(text), fileName: name };
  }

  if (/\.pdf$/i.test(lower) || mime === "application/pdf") {
    const text = await extractPdfText(await file.arrayBuffer());
    return { kind: "text", text: clipText(text), fileName: name };
  }

  if (/\.doc$/i.test(lower)) {
    throw new Error("暂不支持旧版 .doc，请另存为 .docx / .pdf / .txt 后再上传");
  }

  // txt / md / 其它纯文本
  const text = await file.text();
  if (!text.trim()) throw new Error("文件内容为空");
  return { kind: "text", text: clipText(text), fileName: name };
}

function clipText(text) {
  const cleaned = String(text || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length <= MAX_TEXT_CHARS) return cleaned;
  return `${cleaned.slice(0, MAX_TEXT_CHARS)}\n\n[内容过长，已截断]`;
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

async function extractDocxText(arrayBuffer) {
  if (typeof JSZip === "undefined") {
    throw new Error("缺少 JSZip，无法解析 Word");
  }
  const zip = await JSZip.loadAsync(arrayBuffer);
  const doc = zip.file("word/document.xml");
  if (!doc) throw new Error("无效的 Word 文件（缺少 document.xml）");
  const xml = await doc.async("string");
  const withBreaks = xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n");
  const text = withBreaks.replace(/<[^>]+>/g, "");
  const decoded = decodeXmlEntities(text);
  if (!decoded.trim()) throw new Error("未能从 Word 中提取到文本");
  return decoded;
}

function decodeXmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

async function extractPdfText(arrayBuffer) {
  const pdfjs = globalThis.pdfjsLib;
  if (!pdfjs) throw new Error("缺少 pdf.js，无法解析 PDF");

  const workerUrl = chrome.runtime.getURL("vendor/pdf.worker.min.js");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  } catch (err) {
    // worker 加载失败时降级为禁用 worker
    try {
      pdf = await pdfjs.getDocument({
        data: arrayBuffer,
        disableWorker: true
      }).promise;
    } catch (err2) {
      throw new Error(
        `PDF 读取失败：${err2.message || err.message || err}。可改存为 .docx/.txt 再上传`
      );
    }
  }

  const pages = [];
  const maxPages = Math.min(pdf.numPages, 15);
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((item) => ("str" in item ? item.str : "")).filter(Boolean);
    pages.push(strings.join(" "));
  }
  const text = pages.join("\n\n");
  if (!text.trim()) {
    throw new Error("PDF 未提取到文字（可能是扫描件，请改用图片上传或先 OCR）");
  }
  return text;
}

export { extractResumeContent, clipText, MAX_TEXT_CHARS };
