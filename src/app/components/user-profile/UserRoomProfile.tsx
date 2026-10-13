import { Box, Button, config, Icon, Icons, Input, Text } from 'folds';
import React, {
  ChangeEventHandler,
  FocusEventHandler,
  KeyboardEventHandler,
  useEffect,
  useRef,
} from 'react';
import { isKeyHotkey } from 'is-hotkey';
import { useNavigate } from 'react-router-dom';
import { UserHero, UserHeroName } from './UserHero';
import { getMxIdLocalPart, getMxIdServer, mxcUrlToHttp } from '../../utils/matrix';
import {
  getMemberAvatarMxc,
  getMemberDisplayName,
  getMemberServerDisplayName,
} from '../../utils/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoom } from '../../hooks/useRoom';
import { useUserPresence } from '../../hooks/useUserPresence';
import { IgnoredUserAlert, MutualRoomsChip, OptionsChip, ServerChip, ShareChip } from './UserChips';
import { useCloseUserRoomProfile } from '../../state/hooks/userRoomProfile';
import { PowerChip } from './PowerChip';
import { UserInviteAlert, UserBanAlert, UserModeration, UserKickAlert } from './UserModeration';
import { useIgnoredUsers } from '../../hooks/useIgnoredUsers';
import { useMembership } from '../../hooks/useMembership';
import { Membership } from '../../../types/matrix/room';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useMemberPowerCompare } from '../../hooks/useMemberPowerCompare';
import { CreatorChip } from './CreatorChip';
import { getDirectCreatePath, withSearchParam } from '../../pages/pathUtils';
import { DirectCreateSearchParams } from '../../pages/paths';
import { setLocalNickname, useLocalNicknames } from '../../state/localNicknames';

type LocalNicknameInputProps = {
  userId: string;
  nickname?: string;
  serverName: string;
};
function LocalNicknameInput({ userId, nickname, serverName }: LocalNicknameInputProps) {
  // Unsaved edit, if any. Clicking outside closes the profile card and unmounts
  // the input before it gets a blur event, so pending edits are also saved on
  // unmount.
  const pendingRef = useRef<string>();

  useEffect(
    () => () => {
      if (pendingRef.current !== undefined) setLocalNickname(userId, pendingRef.current);
    },
    [userId]
  );

  const save = (value: string) => {
    pendingRef.current = undefined;
    setLocalNickname(userId, value);
  };

  const handleChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    pendingRef.current = evt.currentTarget.value;
  };

  const handleBlur: FocusEventHandler<HTMLInputElement> = (evt) => {
    save(evt.currentTarget.value);
  };

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (evt) => {
    if (isKeyHotkey('enter', evt)) {
      evt.currentTarget.blur();
    }
    if (isKeyHotkey('escape', evt)) {
      // Escape discards the edit.
      pendingRef.current = undefined;
      // eslint-disable-next-line no-param-reassign
      evt.currentTarget.value = nickname ?? '';
      evt.currentTarget.blur();
    }
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Local Nickname</Text>
      <Input
        // Remount when the saved nickname changes so the field shows it.
        key={nickname ?? ''}
        defaultValue={nickname ?? ''}
        placeholder={serverName}
        size="300"
        variant="Background"
        radii="300"
        maxLength={255}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
    </Box>
  );
}

type UserRoomProfileProps = {
  userId: string;
};
export function UserRoomProfile({ userId }: UserRoomProfileProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const navigate = useNavigate();
  const closeUserRoomProfile = useCloseUserRoomProfile();
  const ignoredUsers = useIgnoredUsers();
  const ignored = ignoredUsers.includes(userId);

  const room = useRoom();
  const powerLevels = usePowerLevels(room);
  const creators = useRoomCreators(room);

  const permissions = useRoomPermissions(creators, powerLevels);
  const { hasMorePower } = useMemberPowerCompare(creators, powerLevels);

  const myUserId = mx.getSafeUserId();
  const creator = creators.has(userId);

  const canKickUser = permissions.action('kick', myUserId) && hasMorePower(myUserId, userId);
  const canBanUser = permissions.action('ban', myUserId) && hasMorePower(myUserId, userId);
  const canUnban = permissions.action('ban', myUserId);
  const canInvite = permissions.action('invite', myUserId);

  const member = room.getMember(userId);
  const membership = useMembership(room, userId);

  const server = getMxIdServer(userId);
  const localNicknames = useLocalNicknames();
  const displayName = getMemberDisplayName(room, userId);
  const serverDisplayName =
    getMemberServerDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;
  const avatarMxc = getMemberAvatarMxc(room, userId);
  const avatarUrl = (avatarMxc && mxcUrlToHttp(mx, avatarMxc, useAuthentication)) ?? undefined;

  const presence = useUserPresence(userId);

  const handleMessage = () => {
    closeUserRoomProfile();
    const directSearchParam: DirectCreateSearchParams = {
      userId,
    };
    navigate(withSearchParam(getDirectCreatePath(), directSearchParam));
  };

  return (
    <Box direction="Column">
      <UserHero
        userId={userId}
        avatarUrl={avatarUrl}
        presence={presence && presence.lastActiveTs !== 0 ? presence : undefined}
      />
      <Box direction="Column" gap="500" style={{ padding: config.space.S400 }}>
        <Box direction="Column" gap="400">
          <Box gap="400" alignItems="Start">
            <UserHeroName
              displayName={displayName}
              serverName={
                localNicknames.enabled && localNicknames.nicknames[userId]
                  ? serverDisplayName
                  : undefined
              }
              userId={userId}
            />
            {userId !== myUserId && (
              <Box shrink="No">
                <Button
                  size="300"
                  variant="Primary"
                  fill="Solid"
                  radii="300"
                  before={<Icon size="50" src={Icons.Message} filled />}
                  onClick={handleMessage}
                >
                  <Text size="B300">Message</Text>
                </Button>
              </Box>
            )}
          </Box>
          <Box alignItems="Center" gap="200" wrap="Wrap">
            {server && <ServerChip server={server} />}
            <ShareChip userId={userId} />
            {creator ? <CreatorChip /> : <PowerChip userId={userId} />}
            {userId !== myUserId && <MutualRoomsChip userId={userId} />}
            {userId !== myUserId && <OptionsChip userId={userId} />}
          </Box>
        </Box>
        {localNicknames.enabled && userId !== myUserId && (
          <LocalNicknameInput
            userId={userId}
            nickname={localNicknames.nicknames[userId]}
            serverName={serverDisplayName}
          />
        )}
        {ignored && <IgnoredUserAlert />}
        {member && membership === Membership.Ban && (
          <UserBanAlert
            userId={userId}
            reason={member.events.member?.getContent().reason}
            canUnban={canUnban}
            bannedBy={member.events.member?.getSender()}
            ts={member.events.member?.getTs()}
          />
        )}
        {member &&
          membership === Membership.Leave &&
          member.events.member &&
          member.events.member.getSender() !== userId && (
            <UserKickAlert
              reason={member.events.member?.getContent().reason}
              kickedBy={member.events.member?.getSender()}
              ts={member.events.member?.getTs()}
            />
          )}
        {member && membership === Membership.Invite && (
          <UserInviteAlert
            userId={userId}
            reason={member.events.member?.getContent().reason}
            canKick={canKickUser}
            invitedBy={member.events.member?.getSender()}
            ts={member.events.member?.getTs()}
          />
        )}
        <UserModeration
          userId={userId}
          canInvite={canInvite && membership === Membership.Leave}
          canKick={canKickUser && membership === Membership.Join}
          canBan={canBanUser && membership !== Membership.Ban}
        />
      </Box>
    </Box>
  );
}
