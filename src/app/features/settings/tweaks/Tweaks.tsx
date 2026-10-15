import React from 'react';
import { Box, Text, IconButton, Icon, Icons, Scroll, Switch } from 'folds';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { setLocalNicknamesEnabled, useLocalNicknames } from '../../../state/localNicknames';

type TweaksProps = {
  requestClose: () => void;
};

export function Tweaks({ requestClose }: TweaksProps) {
  const [urlPreview, setUrlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [encUrlPreview, setEncUrlPreview] = useSetting(settingsAtom, 'encUrlPreview');
  const { enabled: localNicknames } = useLocalNicknames();
  const [syncSettings, setSyncSettings] = useSetting(settingsAtom, 'syncSettings');

  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              Tweaks
            </Text>
          </Box>
          <Box shrink="No">
            <IconButton onClick={requestClose} variant="Surface">
              <Icon src={Icons.Cross} />
            </IconButton>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <Box direction="Column" gap="700">
              <Box direction="Column" gap="100">
                <Text size="L400">Link Embeds</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                >
                  <SettingTile
                    title="Enable Link Embeds"
                    description="Automatically show previews for links in messages."
                    after={<Switch variant="Primary" value={urlPreview} onChange={setUrlPreview} />}
                  />
                </SequenceCard>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                >
                  <SettingTile
                    title="Enable in Encrypted Rooms"
                    description="Automatically fetch link embeds from encrypted messages."
                    after={
                      <Switch
                        variant="Primary"
                        value={encUrlPreview}
                        onChange={setEncUrlPreview}
                        disabled={!urlPreview}
                      />
                    }
                  />
                </SequenceCard>
              </Box>
              <Box direction="Column" gap="100">
                <Text size="L400">Sync</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                >
                  <SettingTile
                    title="Sync Across Devices"
                    description="Keep settings and nicknames the same on every device signed in to this account (stored privately in your account data). Page zoom, the members panel and Enter-for-newline always stay per device. This switch only affects this device."
                    after={
                      <Switch variant="Primary" value={syncSettings} onChange={setSyncSettings} />
                    }
                  />
                </SequenceCard>
              </Box>
              <Box direction="Column" gap="100">
                <Text size="L400">People</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                >
                  <SettingTile
                    title="Local Nicknames"
                    description="Rename people just for yourself. Set a nickname from their profile card. Only visible to you, never to anyone else."
                    after={
                      <Switch
                        variant="Primary"
                        value={localNicknames}
                        onChange={setLocalNicknamesEnabled}
                      />
                    }
                  />
                </SequenceCard>
              </Box>
            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
