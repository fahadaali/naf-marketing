/* تنزيل ملفٍّ مولَّد في المتصفح.
   كان دالّةً خاصة في pages/PostsList.tsx، وتصديرُ الحملات يحتاجه نفسَه.
   والعلامةُ في أوّل المحتوى (BOM) تجعل إكسل يقرأ العربية نصّاً لا رموزاً. */
export function download(name: string, content: string, mime: string) {
  const blob = new Blob(['﻿' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
