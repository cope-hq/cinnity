import { ReactNode, useCallback } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import {
  getDirectPath,
  getExplorePath,
  getHomePath,
  getInboxPath,
  getSpacePath,
} from '../pages/pathUtils';
import { DIRECT_PATH, EXPLORE_PATH, HOME_PATH, INBOX_PATH, SPACE_PATH } from '../pages/paths';
import { isPreviousPathname } from '../utils/locationHistory';

type BackRouteHandlerProps = {
  children: (onBack: () => void) => ReactNode;
};
export function BackRouteHandler({ children }: BackRouteHandlerProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // Pop the history entry when it is the list we're going back to, so the
  // system back button doesn't bounce between the room and the list.
  const navigateBack = useCallback(
    (path: string) => {
      if (isPreviousPathname(path)) navigate(-1);
      else navigate(path, { replace: true });
    },
    [navigate]
  );

  const goBack = useCallback(() => {
    if (
      matchPath(
        {
          path: HOME_PATH,
          caseSensitive: true,
          end: false,
        },
        location.pathname
      )
    ) {
      navigateBack(getHomePath());
      return;
    }
    if (
      matchPath(
        {
          path: DIRECT_PATH,
          caseSensitive: true,
          end: false,
        },
        location.pathname
      )
    ) {
      navigateBack(getDirectPath());
      return;
    }
    const spaceMatch = matchPath(
      {
        path: SPACE_PATH,
        caseSensitive: true,
        end: false,
      },
      location.pathname
    );
    const encodedSpaceIdOrAlias = spaceMatch?.params.spaceIdOrAlias;
    const decodedSpaceIdOrAlias =
      encodedSpaceIdOrAlias && decodeURIComponent(encodedSpaceIdOrAlias);

    if (decodedSpaceIdOrAlias) {
      navigateBack(getSpacePath(decodedSpaceIdOrAlias));
      return;
    }
    if (
      matchPath(
        {
          path: EXPLORE_PATH,
          caseSensitive: true,
          end: false,
        },
        location.pathname
      )
    ) {
      navigateBack(getExplorePath());
      return;
    }
    if (
      matchPath(
        {
          path: INBOX_PATH,
          caseSensitive: true,
          end: false,
        },
        location.pathname
      )
    ) {
      navigateBack(getInboxPath());
    }
  }, [navigateBack, location]);

  return children(goBack);
}
