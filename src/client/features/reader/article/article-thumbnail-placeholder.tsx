export function ArticleThumbnailPlaceholder() {
  return (
    <svg
      className="article-thumbnail-placeholder-artwork"
      viewBox="0 0 154 120"
      fill="none"
      aria-hidden="true"
    >
      <g className="thumbnail-grid-field">
        <rect x="38" y="22" width="22" height="22" rx="5" />
        <rect x="66" y="22" width="22" height="22" rx="5" />
        <rect x="94" y="22" width="22" height="22" rx="5" />
        <rect x="38" y="50" width="22" height="22" rx="5" />
        <rect x="66" y="50" width="22" height="22" rx="5" />
        <rect x="38" y="78" width="22" height="22" rx="5" />
      </g>
      <path className="thumbnail-grid-fold-line" d="M94 50h22v22H94z" />
    </svg>
  );
}
