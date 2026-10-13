import React, { useCallback } from 'react';
import { Box, Text, Switch, Button, color, Spinner } from 'folds';
import { IPusherRequest } from 'matrix-js-sdk';
import { useAtom } from 'jotai';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { getNotificationState, usePermissionState } from '../../../hooks/usePermission';
import { useEmailNotifications } from '../../../hooks/useEmailNotifications';
import {
  AsyncStatus,
  useAsyncCallback,
  useAsyncCallbackValue,
} from '../../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { webPushActiveAtom } from '../../../state/webPush';
import {
  fetchPushGatewayInfo,
  PushGatewayInfo,
  pushGatewayEnabled,
} from '../../../utils/pushGateway';
import {
  disableWebPush,
  enableWebPush,
  isIOSOutsideHomeScreen,
  webPushSupported,
} from '../../../utils/webPush';

function EmailNotification() {
  const mx = useMatrixClient();
  const [result, refreshResult] = useEmailNotifications();

  const [setState, setEnable] = useAsyncCallback(
    useCallback(
      async (email: string, enable: boolean) => {
        if (enable) {
          await mx.setPusher({
            kind: 'email',
            app_id: 'm.email',
            pushkey: email,
            app_display_name: 'Email Notifications',
            device_display_name: email,
            lang: 'en',
            data: {
              brand: 'Cinny',
            },
            append: true,
          });
          return;
        }
        await mx.setPusher({
          pushkey: email,
          app_id: 'm.email',
          kind: null,
        } as unknown as IPusherRequest);
      },
      [mx]
    )
  );

  const handleChange = (value: boolean) => {
    if (result && result.email) {
      setEnable(result.email, value).then(() => {
        refreshResult();
      });
    }
  };

  return (
    <SettingTile
      title="Email Notification"
      description={
        <>
          {result && !result.email && (
            <Text as="span" style={{ color: color.Critical.Main }} size="T200">
              Your account does not have any email attached.
            </Text>
          )}
          {result && result.email && <>Send notification to your email. {`("${result.email}")`}</>}
          {result === null && (
            <Text as="span" style={{ color: color.Critical.Main }} size="T200">
              Unexpected Error!
            </Text>
          )}
          {result === undefined && 'Send notification to your email.'}
        </>
      }
      after={
        <>
          {setState.status !== AsyncStatus.Loading &&
            typeof result === 'object' &&
            result?.email && <Switch value={result.enabled} onChange={handleChange} />}
          {(setState.status === AsyncStatus.Loading || result === undefined) && (
            <Spinner variant="Secondary" />
          )}
        </>
      }
    />
  );
}

function PushNotificationTile({ info }: { info: PushGatewayInfo }) {
  const mx = useMatrixClient();
  const [active, setActive] = useAtom(webPushActiveAtom);

  const [toggleState, toggle] = useAsyncCallback(
    useCallback(
      async (enable: boolean) => {
        if (enable) {
          await enableWebPush(mx, info);
          setActive(true);
          return;
        }
        await disableWebPush(mx);
        setActive(false);
      },
      [mx, info, setActive]
    )
  );

  const iosHint = isIOSOutsideHomeScreen();
  const supported = webPushSupported();

  let description: React.ReactNode =
    'Get notified on this device even when Cinny is closed. Message text from encrypted rooms is never included.';
  if (iosHint) {
    description =
      'To get notifications on iOS, add Cinny to your Home Screen (Share → Add to Home Screen) and enable them from there. Requires iOS 16.4 or later.';
  } else if (!supported) {
    description = 'Push notifications are not supported by this browser.';
  } else if (toggleState.status === AsyncStatus.Error) {
    description = (
      <Text as="span" style={{ color: color.Critical.Main }} size="T200">
        {toggleState.error instanceof Error
          ? toggleState.error.message
          : 'Failed to update push notifications.'}
      </Text>
    );
  }

  return (
    <SettingTile
      title="Push Notifications"
      description={description}
      after={
        !iosHint &&
        supported &&
        (toggleState.status === AsyncStatus.Loading ? (
          <Spinner variant="Secondary" />
        ) : (
          <Switch value={active} onChange={toggle} />
        ))
      }
    />
  );
}

function PushNotification() {
  const [infoState] = useAsyncCallbackValue(useCallback(() => fetchPushGatewayInfo(), []));
  if (infoState.status !== AsyncStatus.Success || !infoState.data) return null;

  return (
    <SequenceCard
      className={SequenceCardStyle}
      variant="SurfaceVariant"
      direction="Column"
      gap="400"
    >
      <PushNotificationTile info={infoState.data} />
    </SequenceCard>
  );
}

export function SystemNotification() {
  const notifPermission = usePermissionState('notifications', getNotificationState());
  const [showNotifications, setShowNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [isNotificationSounds, setIsNotificationSounds] = useSetting(
    settingsAtom,
    'isNotificationSounds'
  );

  const requestNotificationPermission = () => {
    window.Notification.requestPermission();
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">System</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Desktop Notifications"
          description={
            notifPermission === 'denied' ? (
              <Text as="span" style={{ color: color.Critical.Main }} size="T200">
                {'Notification' in window
                  ? 'Notification permission is blocked. Please allow notification permission from browser address bar.'
                  : 'Notifications are not supported by the system.'}
              </Text>
            ) : (
              <span>Show desktop notifications when message arrive.</span>
            )
          }
          after={
            notifPermission === 'prompt' ? (
              <Button size="300" radii="300" onClick={requestNotificationPermission}>
                <Text size="B300">Enable</Text>
              </Button>
            ) : (
              <Switch
                disabled={notifPermission !== 'granted'}
                value={showNotifications}
                onChange={setShowNotifications}
              />
            )
          }
        />
      </SequenceCard>
      {pushGatewayEnabled && <PushNotification />}
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Notification Sound"
          description="Play sound when new message arrive."
          after={<Switch value={isNotificationSounds} onChange={setIsNotificationSounds} />}
        />
      </SequenceCard>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <EmailNotification />
      </SequenceCard>
    </Box>
  );
}
