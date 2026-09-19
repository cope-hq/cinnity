import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { mDirectAtom } from '../../../state/mDirectList';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { useOrphanRooms } from '../../../state/hooks/roomList';
import { favouriteRoomsAtom } from '../../../state/room/favouriteRooms';
import { isRoom } from '../../../utils/room';

export const useHomeRooms = () => {
  const mx = useMatrixClient();
  const allRooms = useAtomValue(allRoomsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const favourites = useAtomValue(favouriteRoomsAtom);
  const orphanRooms = useOrphanRooms(mx, allRoomsAtom, mDirects, roomToParents);

  return useMemo(() => {
    const homeRooms = new Set(orphanRooms);
    allRooms.forEach((roomId) => {
      if (!mDirects.has(roomId) && favourites.has(roomId) && isRoom(mx.getRoom(roomId))) {
        homeRooms.add(roomId);
      }
    });
    return Array.from(homeRooms);
  }, [mx, allRooms, orphanRooms, favourites, mDirects]);
};
