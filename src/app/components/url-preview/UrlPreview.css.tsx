import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

export const UrlPreview = style([
  DefaultReset,
  {
    width: toRem(520),
    maxWidth: '100%',
    minWidth: 0,
    containerType: 'inline-size',
    alignSelf: 'flex-start',
    flexDirection: 'column',
    backgroundColor: color.SurfaceVariant.Container,
    color: color.SurfaceVariant.OnContainer,
    borderLeft: `${toRem(4)} solid var(--url-preview-accent, ${
      color.SurfaceVariant.ContainerLine
    })`,
    borderRadius: config.radii.R300,
    overflow: 'hidden',
  },
]);

export const UrlPreviewImg = style([
  DefaultReset,
  {
    display: 'block',
    width: 'auto',
    maxWidth: `calc(100% - ${toRem(16)})`,
    maxHeight: toRem(300),
    margin: `0 ${config.space.S200} ${config.space.S200}`,
    borderRadius: config.radii.R300,
    objectFit: 'cover',
    objectPosition: 'center',
    cursor: 'pointer',

    ':hover': {
      filter: 'brightness(0.85)',
    },

    ':focus-visible': {
      outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
      outlineOffset: toRem(2),
    },
  },
]);

export const UrlPreviewGallery = style([
  DefaultReset,
  {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: toRem(4),
    margin: `0 ${config.space.S200} ${config.space.S200}`,
  },
]);

export const UrlPreviewGalleryItem = style([
  DefaultReset,
  {
    minWidth: 0,
    height: toRem(300),
    display: 'grid',
    placeItems: 'center',
    overflow: 'hidden',
    borderRadius: config.radii.R300,

    '@supports': {
      '(width: 1cqi)': {
        height: `clamp(${toRem(160)}, 58cqi, ${toRem(300)})`,
      },
    },
  },
]);

export const UrlPreviewGalleryImg = style([
  DefaultReset,
  {
    width: '100%',
    maxWidth: 'none',
    height: '100%',
    maxHeight: 'none',
    margin: 0,
    borderRadius: 0,
    objectFit: 'cover',
  },
]);

export const UrlPreviewMedia = style([
  DefaultReset,
  {
    display: 'block',
    width: `calc(100% - ${toRem(16)})`,
    maxHeight: toRem(300),
    margin: `0 ${config.space.S200} ${config.space.S200}`,
    borderRadius: config.radii.R300,
  },
]);

export const UrlPreviewContent = style([
  DefaultReset,
  {
    minWidth: 0,
    padding: config.space.S200,
  },
]);

export const UrlPreviewProvider = style([
  DefaultReset,
  {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
]);

export const UrlPreviewTitle = style([
  DefaultReset,
  {
    color: color.Primary.Main,
    fontWeight: 600,
    textDecoration: 'none',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',

    ':hover': {
      textDecoration: 'underline',
    },
  },
]);

export const UrlPreviewDescription = style([
  DefaultReset,
  {
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
  },
]);

export const UrlPreviewConsent = style([
  DefaultReset,
  {
    alignSelf: 'flex-start',
  },
]);

export const UrlPreviewMediaAction = style([
  DefaultReset,
  {
    alignSelf: 'flex-start',
    margin: `0 ${config.space.S200} ${config.space.S200}`,
  },
]);
