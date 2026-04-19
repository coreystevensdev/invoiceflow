import { headers } from "next/headers";
import { userAgent } from "next/server";

interface SupportAssessment {
  supported: boolean;
  reason?: string;
}

const MIN_MAJORS: Record<string, number> = {
  Chrome: 110,
  Firefox: 115,
  Safari: 16,
  Edge: 110,
  Opera: 95,
  "Samsung Internet": 22,
};

function assessSupport(ua: string, browser: string | undefined, major: string | undefined): SupportAssessment {
  if (/\bMSIE\s|\bTrident\//.test(ua)) {
    return {
      supported: false,
      reason: "Internet Explorer is not supported. It stopped receiving security updates in 2022.",
    };
  }

  const isWebView =
    /;\s*wv\)/.test(ua) ||
    /\bWebView\b/.test(ua) ||
    /Android.*Version\/[0-3]\.\d+/.test(ua);
  if (isWebView) {
    return {
      supported: false,
      reason:
        "This looks like an older Android WebView without modern JavaScript features.",
    };
  }

  if (browser && major) {
    const majorNum = Number.parseInt(major, 10);
    const threshold = MIN_MAJORS[browser];
    if (threshold && Number.isFinite(majorNum) && majorNum < threshold) {
      return {
        supported: false,
        reason: `${browser} ${major} is below the minimum supported version (${browser} ${threshold}+).`,
      };
    }
  }

  return { supported: true };
}

export async function UpgradeBrowserNotice() {
  const h = await headers();
  const ua = userAgent({ headers: h });
  const assessment = assessSupport(ua.ua, ua.browser.name, ua.browser.major);

  if (assessment.supported) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2">
        <span aria-hidden="true" className="font-semibold">
          ⚠
        </span>
        <span>
          <strong>Your browser may not render this page correctly.</strong>{" "}
          {assessment.reason} For the best experience, update to the latest
          version of{" "}
          <a
            className="underline"
            href="https://www.google.com/chrome/"
            rel="noreferrer"
          >
            Chrome
          </a>
          ,{" "}
          <a
            className="underline"
            href="https://www.mozilla.org/firefox/"
            rel="noreferrer"
          >
            Firefox
          </a>
          ,{" "}
          <a
            className="underline"
            href="https://www.apple.com/safari/"
            rel="noreferrer"
          >
            Safari
          </a>
          , or{" "}
          <a
            className="underline"
            href="https://www.microsoft.com/edge"
            rel="noreferrer"
          >
            Edge
          </a>
          .
        </span>
      </div>
    </div>
  );
}
