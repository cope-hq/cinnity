// Importing matrix-js-sdk first ensures its logger module has installed its
// own loglevel methodFactory, which we then wrap.
import 'matrix-js-sdk';
import loglevel from 'loglevel';

/**
 * Drop matrix-js-sdk's trace/debug/info logging in production builds.
 *
 * `logger.setLevel()` isn't enough: every prefixed SDK logger forces its own
 * level to DEBUG when created. A production profile showed thousands of
 * `console.info` calls (plus stack capture) during startup, so filter at the
 * methodFactory instead; child loggers copy the parent's factory.
 */
const quietSdkLogs = () => {
  if (!import.meta.env.PROD) return;

  const wrap =
    (factory: loglevel.MethodFactory): loglevel.MethodFactory =>
    (methodName, level, loggerName) =>
      methodName === 'warn' || methodName === 'error'
        ? factory(methodName, level, loggerName)
        : () => undefined;

  loglevel.methodFactory = wrap(loglevel.methodFactory);
  Object.values(loglevel.getLoggers()).forEach((childLogger) => {
    // eslint-disable-next-line no-param-reassign
    childLogger.methodFactory = wrap(childLogger.methodFactory);
  });
  // Rebuilding the root logger also rebuilds every existing child logger.
  loglevel.rebuild();
};

quietSdkLogs();
