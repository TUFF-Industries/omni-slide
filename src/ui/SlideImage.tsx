import type { Slide } from '../model/types';
import { useAssetUrl, type AssetSize } from '../storage/assetUrl';

export default function SlideImage({
  slide,
  className,
  size = 'full',
}: {
  slide: Slide | undefined;
  className?: string;
  /** 'thumb' for grids and lists: a small copy, decoded off the main thread. */
  size?: AssetSize;
}) {
  const url = useAssetUrl(slide?.assetId, size);
  if (!slide || !url) return <div className={`slide-img placeholder ${className ?? ''}`} />;
  return (
    <img
      className={`slide-img ${className ?? ''}`}
      src={url}
      alt={slide.source ?? ''}
      draggable={false}
      decoding={size === 'thumb' ? 'async' : 'auto'}
      loading={size === 'thumb' ? 'lazy' : 'eager'}
    />
  );
}
