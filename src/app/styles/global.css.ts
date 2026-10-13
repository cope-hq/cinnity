import { globalStyle } from '@vanilla-extract/css';
import { color } from 'folds';

// Fill the safe-area insets (notch, status bar, home indicator) around #root
// with the theme background instead of the browser default.
globalStyle('body', {
  backgroundColor: color.Background.Container,
});
