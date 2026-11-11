/**
 * Menolak hasil yang menyimpang jauh dari penarikan berhasil sebelumnya (mis. portal berubah dan skrip hanya menangkap
 * sebagian). Lebih baik tidak memperbarui daripada menimpa data bagus dengan data buruk.
 */
export function checkAgainstPrevious({ seen, previousSeen, minRatio = 0.7 }) {
  if (seen === 0) return { ok: false, reason: "Tidak ada satu pun sekolah yang berhasil diambil." };
  if (previousSeen && seen < previousSeen * minRatio) {
    return { ok: false, reason: `Hanya ${seen} sekolah terambil, padahal penarikan berhasil sebelumnya ${previousSeen} (batas minimal ${Math.ceil(previousSeen * minRatio)}).` };
  }
  return { ok: true };
}
