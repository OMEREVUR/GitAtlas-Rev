// GitHub katmanının (graphql, prApi, provider, githubLayer) kullanıcıya görünen metinleri.
// Türkçe metinler eski hâliyle birebir aynıdır. GitHub'ın kendi mesajları (msg) çevrilmeden eklenir.
import { defineText } from './index';

export const text = defineText({
  tr: {
    unknownError: 'bilinmeyen hata',
    rateLimited: 'GitHub istek limiti doldu.',
    repoNotFound: "GitHub'da depo bulunamadı ya da erişim izni yok.",
    repoNotFoundWith: (msg: string) => `GitHub'da depo bulunamadı ya da erişim izni yok: ${msg}`,
    forbiddenWith: (msg: string) => `GitHub erişimi reddedildi: ${msg}`,
    forbidden: 'GitHub erişimi reddedildi (izin ya da SSO yetkisi eksik olabilir).',
    apiError: (msg: string) => `GitHub API hatası: ${msg}`,
    network: "GitHub'a ulaşılamadı. İnternet bağlantısını kontrol edin.",
    sessionInvalid: 'GitHub oturumu geçersiz ya da süresi doldu.',
    requestFailed: (status: number) => `GitHub isteği başarısız oldu (HTTP ${status}).`,
    unreadableResponse: 'GitHub yanıtı okunamadı.',
    unexpectedResponse: 'GitHub yanıtı beklenmedik biçimde.',
    noSession: 'GitHub oturumu yok.',
    dataUnavailable: 'GitHub verisi alınamadı.',
    prAlreadyOpen: 'Bu branch için zaten açık bir PR var.',
    prNoDiff: 'PR açılamadı: base ile head arasında fark yok.',
    prCreateFailed: (msg: string) => `PR açılamadı: ${msg}`,
    requestRejected: 'GitHub isteği reddetti.',
    mergeBlocked: (msg: string) =>
      `PR birleştirilemedi: check'ler, zorunlu onaylar ya da çakışma engelliyor olabilir.${msg ? ` (GitHub: ${msg})` : ''}`,
    headChanged: "PR'ın head'i değişti, yenileyip tekrar deneyin.",
    mergeFailed: (msg: string) => `PR birleştirilemedi.${msg ? ` (GitHub: ${msg})` : ''}`,
  },
  en: {
    unknownError: 'unknown error',
    rateLimited: 'GitHub rate limit reached.',
    repoNotFound: 'Repository not found on GitHub, or you have no access.',
    repoNotFoundWith: (msg: string) => `Repository not found on GitHub, or you have no access: ${msg}`,
    forbiddenWith: (msg: string) => `GitHub access denied: ${msg}`,
    forbidden: 'GitHub access denied (a permission or SSO authorization may be missing).',
    apiError: (msg: string) => `GitHub API error: ${msg}`,
    network: "Couldn't reach GitHub. Check your internet connection.",
    sessionInvalid: 'Your GitHub session is invalid or has expired.',
    requestFailed: (status: number) => `GitHub request failed (HTTP ${status}).`,
    unreadableResponse: "Couldn't read the response from GitHub.",
    unexpectedResponse: 'Unexpected response from GitHub.',
    noSession: 'No GitHub session.',
    dataUnavailable: "Couldn't load GitHub data.",
    prAlreadyOpen: 'There is already an open PR for this branch.',
    prNoDiff: "Couldn't open the PR: there are no differences between base and head.",
    prCreateFailed: (msg: string) => `Couldn't open the PR: ${msg}`,
    requestRejected: 'GitHub rejected the request.',
    mergeBlocked: (msg: string) =>
      `Couldn't merge the PR: checks, required reviews or conflicts may be blocking it.${msg ? ` (GitHub: ${msg})` : ''}`,
    headChanged: "The PR's head changed; refresh and try again.",
    mergeFailed: (msg: string) => `Couldn't merge the PR.${msg ? ` (GitHub: ${msg})` : ''}`,
  },
});
