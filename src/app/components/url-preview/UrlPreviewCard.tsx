import React, { CSSProperties, useCallback, useEffect, useState } from 'react';
import classNames from 'classnames';
import { IPreviewUrlResponse } from 'matrix-js-sdk';
import { Box, Button, Spinner, Text, as, config } from 'folds';
import { ImageOverlay } from '../ImageOverlay';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { UrlPreview, UrlPreviewContent, UrlPreviewDescription, UrlPreviewImg } from './UrlPreview';
import * as css from './UrlPreviewCard.css';
import * as previewCss from './UrlPreview.css';
import { tryDecodeURIComponent } from '../../utils/dom';
import { mxcUrlToHttp } from '../../utils/matrix';
import {
  embedBackendEnabled,
  fetchEmbedMedia,
  fetchEmbedPreview,
  type EmbedPreview,
  type EmbedPreviewMedia,
} from '../../utils/embedBackend';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { ImageViewer } from '../image-viewer';
import { onEnterOrSpace } from '../../utils/keyboard';
import { useObjectURL } from '../../hooks/useObjectURL';

// cinny-old port: cap previews per message (LINK_PREVIEWS.md allowed two
// links/message) and keep homeserver preview media Matrix-only.
export const MAX_PREVIEWS_PER_MESSAGE = 2;

/** Strip fragments and credential-bearing URLs; mirrors cinny-old extraction. */
export const sanitizePreviewUrl = (raw: string): string | undefined => {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    if (parsed.username || parsed.password) return undefined;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
};

const getUrlHost = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return tryDecodeURIComponent(url);
  }
};

const validAccent = (value: unknown): string | undefined =>
  typeof value === 'string' && /^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(value) ? value : undefined;

const accentStyle = (accent?: string): CSSProperties | undefined =>
  accent ? ({ '--url-preview-accent': accent } as CSSProperties) : undefined;

function PreviewText({
  url,
  provider,
  author,
  title,
  description,
}: {
  url: string;
  provider?: string;
  author?: string;
  title?: string;
  description?: string;
}) {
  return (
    <UrlPreviewContent>
      <Text className={previewCss.UrlPreviewProvider} size="T200" priority="300">
        {provider || getUrlHost(url)}
      </Text>
      {author && (
        <Text className={previewCss.UrlPreviewProvider} size="T200" priority="300">
          {author}
        </Text>
      )}
      <Text
        className={previewCss.UrlPreviewTitle}
        as="a"
        href={url}
        target="_blank"
        rel="noreferrer"
        size="B300"
      >
        {title || tryDecodeURIComponent(url)}
      </Text>
      {description && (
        <Text size="T200" priority="400">
          <UrlPreviewDescription>{description}</UrlPreviewDescription>
        </Text>
      )}
    </UrlPreviewContent>
  );
}

function EmbedMediaView({
  media,
  alt,
  tiled = false,
}: {
  media: EmbedPreviewMedia;
  alt: string;
  tiled?: boolean;
}) {
  const [requestedId, setRequestedId] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [blob, setBlob] = useState<Blob>();
  const [failed, setFailed] = useState(false);
  const [viewer, setViewer] = useState(false);
  const src = useObjectURL(blob);
  const shouldFetch = media.kind === 'image' || requestedId === media.id;

  useEffect(() => {
    if (!shouldFetch) return undefined;
    const controller = new AbortController();
    setBlob(undefined);
    setFailed(false);
    fetchEmbedMedia(media, controller.signal)
      .then(setBlob)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [media, shouldFetch, attempt]);

  if (!src) {
    if (media.kind === 'image' && !failed) return null;
    return (
      <Button
        className={previewCss.UrlPreviewMediaAction}
        size="300"
        variant="Secondary"
        onClick={() => {
          setRequestedId(media.id);
          setAttempt((current) => current + 1);
        }}
      >
        <Text as="span" size="B300">
          {failed ? 'Retry media' : `Play ${media.kind}`}
        </Text>
      </Button>
    );
  }

  if (media.kind === 'image') {
    return (
      <>
        <UrlPreviewImg
          className={classNames(tiled && previewCss.UrlPreviewGalleryImg)}
          src={src}
          alt={alt}
          title={alt}
          tabIndex={0}
          onKeyDown={(evt) => onEnterOrSpace(() => setViewer(true))(evt)}
          onClick={() => setViewer(true)}
        />
        <ImageOverlay
          src={src}
          alt={alt}
          viewer={viewer}
          requestClose={() => setViewer(false)}
          renderViewer={(props) => <ImageViewer {...props} />}
        />
      </>
    );
  }

  // Preview media may not provide captions; controls stay user-initiated.
  /* eslint-disable jsx-a11y/media-has-caption */
  return media.kind === 'video' ? (
    <video className={previewCss.UrlPreviewMedia} src={src} controls preload="none" />
  ) : (
    <audio className={previewCss.UrlPreviewMedia} src={src} controls preload="none" />
  );
  /* eslint-enable jsx-a11y/media-has-caption */
}

export const UrlPreviewCard = as<'div', { url: string; ts: number }>(
  ({ url, ts, ...props }, ref) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const [viewer, setViewer] = useState(false);
    const [previewStatus, loadPreview] = useAsyncCallback(
      useCallback(
        () => (embedBackendEnabled ? fetchEmbedPreview(url) : mx.getUrlPreview(url, ts)),
        [url, ts, mx]
      )
    );

    useEffect(() => {
      loadPreview().catch(() => undefined);
    }, [loadPreview]);

    if (previewStatus.status === AsyncStatus.Error) {
      return (
        <Button
          className={previewCss.UrlPreviewConsent}
          size="300"
          variant="Secondary"
          onClick={() => loadPreview().catch(() => undefined)}
        >
          <Text as="span" size="B300">
            Retry preview
          </Text>
        </Button>
      );
    }

    if (embedBackendEnabled && previewStatus.status === AsyncStatus.Success) {
      const embed = previewStatus.data as unknown as EmbedPreview | null;
      if (!embed) return null;
      const media = embed.media ?? [];
      const imageGallery = media.length > 1 && media.every((item) => item.kind === 'image');
      const mediaAlt = embed.title || getUrlHost(url);
      return (
        <UrlPreview {...props} ref={ref} style={accentStyle(embed.color)}>
          <PreviewText
            url={url}
            provider={embed.siteName}
            author={embed.author}
            title={embed.title}
            description={embed.description}
          />
          {imageGallery ? (
            <div className={previewCss.UrlPreviewGallery}>
              {media.map((item) => (
                <div key={item.id} className={previewCss.UrlPreviewGalleryItem}>
                  <EmbedMediaView media={item} alt={mediaAlt} tiled />
                </div>
              ))}
            </div>
          ) : (
            media.map((item) => <EmbedMediaView key={item.id} media={item} alt={mediaAlt} />)
          )}
        </UrlPreview>
      );
    }

    const renderContent = (prev: IPreviewUrlResponse) => {
      // Only MXC references become browser media requests. External OpenGraph
      // media URLs are never loaded directly.
      const previewMxc =
        typeof prev['og:image'] === 'string' && prev['og:image'].startsWith('mxc://')
          ? prev['og:image']
          : '';
      const thumbUrl = previewMxc
        ? mxcUrlToHttp(mx, previewMxc, useAuthentication, 512, 320, 'scale', false)
        : null;
      const imgUrl = previewMxc ? mxcUrlToHttp(mx, previewMxc, useAuthentication) : null;
      const provider =
        typeof prev['og:site_name'] === 'string' ? prev['og:site_name'] : getUrlHost(url);
      let author: string | undefined;
      if (typeof prev['article:author'] === 'string') author = prev['article:author'];
      else if (typeof prev.author_name === 'string') author = prev.author_name;
      const title = typeof prev['og:title'] === 'string' ? prev['og:title'] : undefined;
      const description =
        typeof prev['og:description'] === 'string' ? prev['og:description'] : undefined;
      const accent = validAccent(prev['og:theme-color'] ?? prev['theme-color']);

      return (
        <UrlPreview {...props} ref={ref} style={accentStyle(accent)}>
          <PreviewText
            url={url}
            provider={provider}
            author={author}
            title={title}
            description={description}
          />
          {thumbUrl && (
            <UrlPreviewImg
              src={thumbUrl}
              alt={title ?? ''}
              title={title}
              tabIndex={0}
              onKeyDown={(evt) => onEnterOrSpace(() => setViewer(true))(evt)}
              onClick={() => setViewer(true)}
            />
          )}
          {imgUrl && (
            <ImageOverlay
              src={imgUrl}
              alt={title ?? ''}
              viewer={viewer}
              requestClose={() => setViewer(false)}
              renderViewer={(viewerProps) => <ImageViewer {...viewerProps} mxcUri={previewMxc} />}
            />
          )}
        </UrlPreview>
      );
    };

    if (previewStatus.status === AsyncStatus.Success) {
      return renderContent(previewStatus.data);
    }

    return (
      <Box className={previewCss.UrlPreviewConsent} alignItems="Center" justifyContent="Center">
        <Spinner variant="Secondary" size="300" />
      </Box>
    );
  }
);

export const UrlPreviewHolder = as<'div'>(({ children, className, style, ...props }, ref) => (
  <Box
    direction="Column"
    {...props}
    ref={ref}
    className={classNames(css.UrlPreviewHolder, className)}
    style={{ marginTop: config.space.S200, ...style }}
  >
    {children}
  </Box>
));
