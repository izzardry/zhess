import { Link } from "react-router-dom";

/**
 * 404 page per the Ztyle audit (#11): halftone page, wordmark, one muted line, a primary "Back" pill.
 * TODO(i18n): move the two strings into a translation table once src/lib/i18n exists.
 */
const NotFound = () => (
  <div className="halftone-bg flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
    <h1 className="font-mono text-3xl font-light tracking-[0.3em] sm:text-4xl">ZHESS</h1>
    <p className="text-sm text-muted-foreground">404 · This page does not exist.</p>
    <Link to="/" className="btn-primary">
      Back
    </Link>
  </div>
);

export default NotFound;
