import path from "path"
import { simpleSitemapAndIndex } from "sitemap"
import { pluginOptionsSchema, validateOptions } from "./options-validation"
import { prefixPath, pageFilter, ReporterPrefix } from "./internals"

let usedSchemaValidationApi = false

if (process.env.GATSBY_EXPERIMENTAL_PLUGIN_OPTION_VALIDATION) {
  usedSchemaValidationApi = true
  exports.pluginOptionsSchema = pluginOptionsSchema
}

if (!usedSchemaValidationApi) {
  exports.onPreInit = async ({ reporter }, pluginOptions) => {
    try {
      await validateOptions(pluginOptions)
      reporter.verbose(`${ReporterPrefix} Plugin options passed validation.`)
    } catch (err) {
      reporter.panic(err)
    }
  }
}

exports.onPostBuild = async (
  { graphql, reporter, pathPrefix },
  pluginOptions
) => {
  //TODO: This handles if the `pluginOptionsSchema` API was used, can be removed once the API is on by default.
  const {
    output,
    entryLimit,
    query,
    excludes,
    resolveSiteUrl,
    resolvePagePath,
    resolvePages,
    filterPages,
    serialize,
  } = usedSchemaValidationApi
    ? pluginOptions
    : await validateOptions(pluginOptions).catch(err => {
        reporter.panic(err)
      })

  const { data: queryRecords } = await graphql(query)

  reporter.verbose(
    `${ReporterPrefix} Query Results:\n${JSON.stringify(queryRecords, null, 2)}`
  )

  // resolvePages and resolveSuteUrl are allowed to be sync or async. The IIFE handles each possibility
  const allPages = await (async () => resolvePages(queryRecords))().catch(err =>
    reporter.panic(`${ReporterPrefix} Error resolving Pages`, err)
  )

  const siteUrl = await (async () =>
    resolveSiteUrl(queryRecords))().catch(err =>
    reporter.panic(`${ReporterPrefix} Error resolving Site URL`, err)
  )

  if (!Array.isArray(allPages)) {
    reporter.panic(
      `${ReporterPrefix} The \`resolvePages\` function did not return an array.`
    )
  }

  reporter.verbose(
    `${ReporterPrefix} Filtering ${allPages.length} pages based on ${excludes.length} excludes`
  )

  // eslint-disable-next-line consistent-return
  const { filteredPages, messages } = pageFilter(
    {
      allPages,
      filterPages,
      excludes,
    },
    { reporter }
  )

  messages.forEach(message => reporter.verbose(message))

  reporter.verbose(
    `${ReporterPrefix} ${filteredPages.length} pages remain after filtering`
  )

  // eslint-disable-next-line consistent-return
  const serializedPages = filteredPages.map(page => {
    try {
      const { url, ...rest } = serialize(page, { resolvePagePath })
      return { url: prefixPath({ url, siteUrl, pathPrefix }), ...rest }
    } catch (err) {
      reporter.panic(`${ReporterPrefix} Error serializing pages`, err)
    }
  })

  const sitemapPath = path.join(`public`, output)

  return simpleSitemapAndIndex({
    hostname: siteUrl,
    destinationDir: sitemapPath,
    sourceData: serializedPages,
    limit: entryLimit,
    gzip: false,
  })
}
