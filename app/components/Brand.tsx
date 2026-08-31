type BrandProps = {
  compact?: boolean;
  inverse?: boolean;
};

export default function Brand({ compact = false, inverse = true }: BrandProps) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`}>
      <span className="brand__mark brand__mark--jj" aria-hidden="true">
        <span>J</span>
        <span>J</span>
      </span>
      {!compact && (
        <span className={`brand__name ${inverse ? "" : "brand__name--dark"}`}>
          JJ-Media
        </span>
      )}
    </div>
  );
}
