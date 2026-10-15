import React, { CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import classNames from 'classnames';
import { IPreviewUrlResponse } from 'matrix-js-sdk';
import {
  Box,
  Button,
  Icon,
  IconSrc,
  Icons,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Spinner,
  Text,
  as,
  config,
  toRem,
} from 'folds';
import { ImageOverlay } from '../ImageOverlay';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { UrlPreview, UrlPreviewContent, UrlPreviewDescription, UrlPreviewImg } from './UrlPreview';
import * as css from './UrlPreviewCard.css';
import * as previewCss from './UrlPreview.css';
import { copyToClipboard, tryDecodeURIComponent } from '../../utils/dom';
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
import { useObjectURL } from '../../hooks/useObjectURL';
import { useLongPress } from '../../hooks/useLongPress';
import { onEnterOrSpace, stopPropagation } from '../../utils/keyboard';

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

/**
 * Fetch one preview-backend media capability as an object URL. Capabilities
 * expire after a few minutes, so failures are reported to the card, which
 * reloads the preview (issuing fresh capabilities) once.
 */
const useEmbedMediaSrc = (
  media: EmbedPreviewMedia | undefined,
  enabled: boolean,
  onError?: () => void
) => {
  const [blob, setBlob] = useState<Blob>();
  const [failed, setFailed] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!media || !enabled) return undefined;
    const controller = new AbortController();
    setBlob(undefined);
    setFailed(false);
    fetchEmbedMedia(media, controller.signal)
      .then(setBlob)
      .catch(() => {
        if (controller.signal.aborted) return;
        setFailed(true);
        onErrorRef.current?.();
      });
    return () => controller.abort();
  }, [media, enabled]);

  return { src: useObjectURL(blob), failed };
};

function EmbedImage({
  media,
  alt,
  tiled = false,
  onError,
}: {
  media: EmbedPreviewMedia;
  alt: string;
  tiled?: boolean;
  onError: () => void;
}) {
  const [viewer, setViewer] = useState(false);
  const { src } = useEmbedMediaSrc(media, true, onError);
  if (!src) return null;

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

/** Poster with a play button; the video is only downloaded once requested. */
function EmbedVideo({
  video,
  poster,
  alt,
  playing,
  onPlay,
  onError,
}: {
  video: EmbedPreviewMedia;
  poster?: EmbedPreviewMedia;
  alt: string;
  playing: boolean;
  onPlay: () => void;
  onError: () => void;
}) {
  const posterMedia = useEmbedMediaSrc(poster, !!poster);
  const videoMedia = useEmbedMediaSrc(video, playing, onError);
  const [ratio, setRatio] = useState<number>();
  const loading = playing && !videoMedia.failed;

  let icon = <Icon size="400" src={Icons.Play} filled />;
  if (videoMedia.failed) icon = <Icon size="400" src={Icons.Warning} />;
  else if (loading) icon = <Spinner variant="Secondary" size="400" />;

  return (
    <div className={previewCss.UrlPreviewVideo} style={{ aspectRatio: ratio ?? 16 / 9 }}>
      {videoMedia.src ? (
        // Preview media may not provide captions; playback is user-initiated.
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          className={previewCss.UrlPreviewVideoFill}
          src={videoMedia.src}
          poster={posterMedia.src}
          controls
          autoPlay
          playsInline
          onLoadedMetadata={(evt) => {
            const { videoWidth, videoHeight } = evt.currentTarget;
            if (videoWidth && videoHeight) setRatio(videoWidth / videoHeight);
          }}
        />
      ) : (
        <>
          {posterMedia.src && (
            <img
              className={previewCss.UrlPreviewVideoFill}
              src={posterMedia.src}
              alt={alt}
              onLoad={(evt) => {
                const { naturalWidth, naturalHeight } = evt.currentTarget;
                if (naturalWidth && naturalHeight) setRatio(naturalWidth / naturalHeight);
              }}
            />
          )}
          <button
            type="button"
            className={previewCss.UrlPreviewPlay}
            onClick={onPlay}
            disabled={loading || videoMedia.failed}
            aria-label={videoMedia.failed ? 'Video unavailable' : 'Play video'}
          >
            {icon}
          </button>
        </>
      )}
    </div>
  );
}

function EmbedAudio({
  media,
  playing,
  onPlay,
  onError,
}: {
  media: EmbedPreviewMedia;
  playing: boolean;
  onPlay: () => void;
  onError: () => void;
}) {
  const { src, failed } = useEmbedMediaSrc(media, playing, onError);
  if (src) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <audio className={previewCss.UrlPreviewMedia} src={src} controls autoPlay />;
  }
  if (failed) return null;
  return (
    <Button
      className={previewCss.UrlPreviewMediaAction}
      size="300"
      variant="Secondary"
      onClick={onPlay}
      disabled={playing}
      before={playing ? <Spinner size="100" variant="Secondary" /> : undefined}
    >
      <Text as="span" size="B300">
        Play audio
      </Text>
    </Button>
  );
}

function EmbedMenu({
  url,
  hasMedia,
  onRetryMedia,
  requestClose,
}: {
  url: string;
  hasMedia: boolean;
  onRetryMedia: () => void;
  requestClose: () => void;
}) {
  const item = (label: string, icon: IconSrc, onClick: () => void) => (
    <MenuItem
      size="300"
      radii="300"
      after={<Icon size="100" src={icon} />}
      onClick={() => {
        onClick();
        requestClose();
      }}
    >
      <Text as="span" size="T300" truncate>
        {label}
      </Text>
    </MenuItem>
  );

  return (
    <Menu style={{ maxWidth: toRem(200), width: '100vw' }}>
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        {hasMedia && item('Retry media', Icons.Reload, onRetryMedia)}
        {item('Open link', Icons.External, () => window.open(url, '_blank', 'noreferrer'))}
        {item('Copy link', Icons.Link, () => copyToClipboard(url))}
      </Box>
    </Menu>
  );
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

    // Embed (preview backend) state. Kept across preview reloads so a video the
    // user started keeps playing with the fresh media capabilities.
    const [videoRequested, setVideoRequested] = useState(false);
    const [audioRequested, setAudioRequested] = useState(false);
    const [menuAnchor, setMenuAnchor] = useState<RectCords>();
    const autoRetriedRef = useRef(false);
    const lastEmbedRef = useRef<EmbedPreview | null>();
    if (embedBackendEnabled && previewStatus.status === AsyncStatus.Success) {
      lastEmbedRef.current = previewStatus.data as unknown as EmbedPreview | null;
    }

    const retryMedia = useCallback(() => {
      loadPreview().catch(() => undefined);
    }, [loadPreview]);
    const handleMediaError = useCallback(() => {
      // Most failures are expired capabilities: reload the preview once.
      if (autoRetriedRef.current) return;
      autoRetriedRef.current = true;
      retryMedia();
    }, [retryMedia]);

    const longPressHandlers = useLongPress(({ x, y }) =>
      setMenuAnchor({ x, y, width: 0, height: 0 })
    );
    const embedMenuHandlers = {
      ...longPressHandlers,
      onPointerDown: (evt: React.PointerEvent) => {
        // Don't also start the message's own long-press menu.
        evt.stopPropagation();
        longPressHandlers.onPointerDown(evt);
      },
      onContextMenu: (evt: React.MouseEvent) => {
        if (evt.altKey) return;
        evt.preventDefault();
        evt.stopPropagation();
        setMenuAnchor({ x: evt.clientX, y: evt.clientY, width: 0, height: 0 });
      },
    };

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

    // Keep showing the last embed while it reloads (e.g. for fresh media).
    const showEmbed =
      embedBackendEnabled &&
      (previewStatus.status === AsyncStatus.Success ||
        previewStatus.status === AsyncStatus.Loading);
    const embed = showEmbed ? lastEmbedRef.current : undefined;
    if (embed !== undefined) {
      if (!embed) return null;
      const media = embed.media ?? [];
      const video = media.find((item) => item.kind === 'video');
      const audio = media.find((item) => item.kind === 'audio');
      const images = media.filter((item) => item.kind === 'image');
      // With a video, the (first) image is its poster, like og:image usually is.
      const poster = video ? images[0] : undefined;
      const otherImages = video ? images.slice(1) : images;
      const mediaAlt = embed.title || getUrlHost(url);
      return (
        <UrlPreview
          {...props}
          ref={ref}
          style={accentStyle(embed.color)}
          className={classNames(props.className, previewCss.UrlPreviewTouch)}
          {...embedMenuHandlers}
        >
          <PreviewText
            url={url}
            provider={embed.siteName}
            author={embed.author}
            title={embed.title}
            description={embed.description}
          />
          {video && (
            <EmbedVideo
              key={video.id}
              video={video}
              poster={poster}
              alt={mediaAlt}
              playing={videoRequested}
              onPlay={() => setVideoRequested(true)}
              onError={handleMediaError}
            />
          )}
          {otherImages.length > 1 ? (
            <div className={previewCss.UrlPreviewGallery}>
              {otherImages.map((item) => (
                <div key={item.id} className={previewCss.UrlPreviewGalleryItem}>
                  <EmbedImage media={item} alt={mediaAlt} tiled onError={handleMediaError} />
                </div>
              ))}
            </div>
          ) : (
            otherImages.map((item) => (
              <EmbedImage key={item.id} media={item} alt={mediaAlt} onError={handleMediaError} />
            ))
          )}
          {audio && (
            <EmbedAudio
              key={audio.id}
              media={audio}
              playing={audioRequested}
              onPlay={() => setAudioRequested(true)}
              onError={handleMediaError}
            />
          )}
          <PopOut
            anchor={menuAnchor}
            position="Bottom"
            align="Start"
            offset={0}
            content={
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  returnFocusOnDeactivate: false,
                  onDeactivate: () => setMenuAnchor(undefined),
                  clickOutsideDeactivates: true,
                  isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                  isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                  escapeDeactivates: stopPropagation,
                }}
              >
                <EmbedMenu
                  url={url}
                  hasMedia={media.length > 0}
                  onRetryMedia={() => {
                    autoRetriedRef.current = false;
                    retryMedia();
                  }}
                  requestClose={() => setMenuAnchor(undefined)}
                />
              </FocusTrap>
            }
          />
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
