import React, { useCallback } from 'react';
import { Icon, Icons, MenuItem, Spinner, Text } from 'folds';
import { useAtomValue, useSetAtom } from 'jotai';
import { Room } from 'matrix-js-sdk/lib/models/room';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { FAVOURITE_ROOM_TAG, favouriteRoomsAtom } from '../../state/room/favouriteRooms';

type RoomFavouriteMenuItemProps = {
  room: Room;
  requestClose: () => void;
};

export function RoomFavouriteMenuItem({ room, requestClose }: RoomFavouriteMenuItemProps) {
  const mx = useMatrixClient();
  const favouriteRooms = useAtomValue(favouriteRoomsAtom);
  const setFavouriteRooms = useSetAtom(favouriteRoomsAtom);
  const favourite = favouriteRooms.has(room.roomId);

  const [toggleState, toggle] = useAsyncCallback(
    useCallback(async () => {
      if (favourite) {
        await mx.deleteRoomTag(room.roomId, FAVOURITE_ROOM_TAG);
        setFavouriteRooms({ type: 'DELETE', roomId: room.roomId });
      } else {
        await mx.setRoomTag(room.roomId, FAVOURITE_ROOM_TAG, { order: 0.5 });
        setFavouriteRooms({ type: 'PUT', roomId: room.roomId });
      }
      requestClose();
    }, [mx, room.roomId, favourite, setFavouriteRooms, requestClose])
  );

  const changing = toggleState.status === AsyncStatus.Loading;
  const failed = toggleState.status === AsyncStatus.Error;
  const handleToggle = () => {
    toggle().catch(() => undefined);
  };

  return (
    <MenuItem
      onClick={handleToggle}
      size="300"
      after={
        changing ? (
          <Spinner size="100" variant="Secondary" />
        ) : (
          <Icon size="100" src={Icons.Star} filled={favourite} />
        )
      }
      radii="300"
      disabled={changing}
      aria-pressed={favourite}
    >
      <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
        {failed
          ? `Retry ${favourite ? 'removing from' : 'adding to'} favourites`
          : `${favourite ? 'Remove from' : 'Add to'} favourites`}
      </Text>
    </MenuItem>
  );
}
