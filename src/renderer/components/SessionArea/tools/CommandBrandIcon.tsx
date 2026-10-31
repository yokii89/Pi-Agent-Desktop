import { getNamedIconUrl } from "../../../fileIcons/resolve";
import { useResolvedTheme } from "../../../hooks/useResolvedTheme";
import type { CommandBrand } from "../../../utils/commandIcon";

/** 命令品牌徽标：复用 fileIcons 资源型 SVG；资产缺失时不渲染。 */
export function CommandBrandIcon({
  brand,
  className,
}: {
  brand: CommandBrand;
  className?: string;
}) {
  const theme = useResolvedTheme();
  const url = getNamedIconUrl(brand.icon, theme);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      width={16}
      height={16}
      className={className}
      draggable={false}
      data-command-brand={brand.id}
    />
  );
}
