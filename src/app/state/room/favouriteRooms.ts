import { atom, useSetAtom } from 'jotai';
import { ClientEvent, MatrixClient } from 'matrix-js-sdk/lib/client';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { Room, RoomEvent } from 'matrix-js-sdk/lib/models/room';
import { useEffect } from 'react';
import { Membership } from '../../../types/matrix/room';

export const FAVOURITE_ROOM_TAG = 'm.favourite';

export const isRoomFavourite = (room: Room): boolean =>
  Object.prototype.hasOwnProperty.call(room.tags, FAVOURITE_ROOM_TAG);

type FavouriteRoomsAction =
  | { type: 'INITIALIZE'; roomIds: string[] }
  | { type: 'PUT' | 'DELETE'; roomId: string };

const baseFavouriteRoomsAtom = atom(new Set<string>());
export const favouriteRoomsAtom = atom<Set<string>, [FavouriteRoomsAction], undefined>(
  (get) => get(baseFavouriteRoomsAtom),
  (get, set, action) => {
    if (action.type === 'INITIALIZE') {
      set(baseFavouriteRoomsAtom, new Set(action.roomIds));
      return undefined;
    }

    set(baseFavouriteRoomsAtom, (current) => {
      const next = new Set(current);
      if (action.type === 'PUT') next.add(action.roomId);
      else next.delete(action.roomId);
      return next;
    });
    return undefined;
  }
);

type FavouriteRoomEventEmitter = {
  on(event: ClientEvent.Room, listener: (room: Room) => void): void;
  on(event: ClientEvent.DeleteRoom, listener: (roomId: string) => void): void;
  on(event: RoomEvent.Tags, listener: (event: MatrixEvent, room: Room) => void): void;
  on(event: RoomEvent.MyMembership, listener: (room: Room) => void): void;
  removeListener(event: ClientEvent.Room, listener: (room: Room) => void): void;
  removeListener(event: ClientEvent.DeleteRoom, listener: (roomId: string) => void): void;
  removeListener(event: RoomEvent.Tags, listener: (event: MatrixEvent, room: Room) => void): void;
  removeListener(event: RoomEvent.MyMembership, listener: (room: Room) => void): void;
};

export const useBindFavouriteRoomsAtom = (
  mx: MatrixClient,
  favourites: typeof favouriteRoomsAtom
) => {
  const setFavourites = useSetAtom(favourites);

  useEffect(() => {
    setFavourites({
      type: 'INITIALIZE',
      roomIds: mx
        .getRooms()
        .filter((room: Room) => room.getMyMembership() === Membership.Join && isRoomFavourite(room))
        .map((room: Room) => room.roomId),
    });

    const updateRoom = (room: Room) => {
      setFavourites({
        type: isRoomFavourite(room) ? 'PUT' : 'DELETE',
        roomId: room.roomId,
      });
    };
    const handleTags = (_event: MatrixEvent, room: Room) => updateRoom(room);
    const handleMembership = (room: Room) => {
      if (room.getMyMembership() === Membership.Join) updateRoom(room);
      else setFavourites({ type: 'DELETE', roomId: room.roomId });
    };
    const handleDelete = (roomId: string) => {
      setFavourites({ type: 'DELETE', roomId });
    };

    const emitter = mx as unknown as FavouriteRoomEventEmitter;
    emitter.on(ClientEvent.Room, updateRoom);
    emitter.on(RoomEvent.Tags, handleTags);
    emitter.on(RoomEvent.MyMembership, handleMembership);
    emitter.on(ClientEvent.DeleteRoom, handleDelete);
    return () => {
      emitter.removeListener(ClientEvent.Room, updateRoom);
      emitter.removeListener(RoomEvent.Tags, handleTags);
      emitter.removeListener(RoomEvent.MyMembership, handleMembership);
      emitter.removeListener(ClientEvent.DeleteRoom, handleDelete);
    };
  }, [mx, setFavourites]);
};
