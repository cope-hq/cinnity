import { style } from '@vanilla-extract/css';
import { DefaultReset, config } from 'folds';

export const UrlPreviewHolder = style([
  DefaultReset,
  {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: config.space.S200,
    width: '100%',
  },
]);
