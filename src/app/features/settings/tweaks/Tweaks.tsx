import React from 'react';
import { Box, Text, IconButton, Icon, Icons, Scroll, Switch } from 'folds';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';

type TweaksProps = {
  requestClose: () => void;
};

export function Tweaks({ requestClose }: TweaksProps) {
  const [urlPreview, setUrlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [encUrlPreview, setEncUrlPreview] = useSetting(settingsAtom, 'encUrlPreview');

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
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
