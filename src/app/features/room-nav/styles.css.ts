import { globalStyle, style } from '@vanilla-extract/css';
import { config } from 'folds';

export const CategoryButton = style({
  flexGrow: 1,
});
export const CategoryButtonIcon = style({
  opacity: config.opacity.P400,
});

// Long-press opens the room menu (useLongPress); stop iOS from showing its own
// link preview/callout or selecting the room name instead.
export const LongPressTarget = style({
  '@media': {
    '(pointer: coarse)': {
      WebkitTouchCallout: 'none',
      userSelect: 'none',
    },
  },
});
globalStyle(`${LongPressTarget} a`, {
  '@media': {
    '(pointer: coarse)': {
      WebkitTouchCallout: 'none',
    },
  },
});
