import { Link } from "react-router-dom";
import { BRAND, useI18n } from "@/lib/i18n";

/** 404 page per the Ztyle audit (#11): halftone page, wordmark, one muted line, a primary "Back" pill. */
const NotFound = () => {
  const { t } = useI18n();
  return (
    <div className="halftone-bg flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="font-mono text-3xl font-light tracking-[0.3em] sm:text-4xl">{BRAND.wordmark}</h1>
      <p className="text-sm text-muted-foreground">404 · {t("notFound")}</p>
      <Link to="/" className="btn-primary">
        {t("back")}
      </Link>
    </div>
  );
};

export default NotFound;
