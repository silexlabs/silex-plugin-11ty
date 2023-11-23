import dedent from 'dedent'
import { Component, Page } from 'grapesjs'
import { DataSourceEditor, IDataSource, IDataSourceModel, StoredState, getPersistantId, getState, getStateIds } from '@silexlabs/grapesjs-data-source'
import { echoBlock, getStateName, ifBlock, loopBlock } from '../liquid'
import { EleventyPluginOptions } from '../client'
import { PublicationTransformer } from '@silexlabs/silex/src/ts/client/publication-transformers'
// This breaks the unit tests in the github action only: import { ClientSideFileType, PublicationData } from '@silexlabs/silex/src/ts/types'

/**
 * Make html attribute
 * Quote strings, no values for boolean
 */
function makeAttribute(key, value) {
  switch (typeof value) {
  case 'boolean': return value ? key : ''
  default: return `${key}="${value}"`
  }
}

/**
 * Make inline style
 */
function makeStyle(key, value) {
  return `${key}: ${value};`
}

/**
 * Comes from silex but didn't manage to import
 * FIXME: expose this from silex
 */
export function transformPath(editor: DataSourceEditor, path: string, type): string {
  const config = editor.getModel().get('config')
  return config.publicationTransformers.reduce((result: string, transformer: PublicationTransformer) => {
    try {
      return transformer.transformPath ? transformer.transformPath(result, type) ?? result : result
    } catch (e) {
      console.error('Publication transformer: error transforming path', result, e)
      return result
    }
  }, path)
}

function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^a-z0-9-]/g, '') // Remove all non-word chars
    .replace(/--+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start of text
    .replace(/-+$/, '') // Trim - from end of text
}

/**
 * Transform the files to be published
 * This hook is called just before the files are written to the file system
 */
export function transformFiles(editor: DataSourceEditor, options: EleventyPluginOptions, data): void {
  editor.Pages.getAll().forEach(page => {
    // Add front matter to the page
    const name = slugify(page.getName() || 'index')
    const path = transformPath(editor, `/${name}.html`, 'html')
    const pageData = data.files.find(file => file.path === path)
    const settings = page.get('settings') as Record<string, string>
    if(!settings) {
      console.warn(`No settings for page ${page.getName() || 'index'}`)
      return
    }
    const frontMatter = dedent`---
      ${settings.eleventyPermalink ? `permalink: "${settings.eleventyPermalink}"` : ''}
      ${settings.eleventyPageData ? `pagination:
        data: ${settings.eleventyPageData}
        ${settings.eleventyPageSize ? `size: ${settings.eleventyPageSize}` : ''}
        ${settings.eleventyPageReverse ? 'reverse: true' : ''}
      ` : ''}
      ${settings.eleventyNavigationKey ? `eleventyNavigation:
        key: ${settings.eleventyNavigationKey}
        ${settings.eleventyNavigationTitle ? `title: ${settings.eleventyNavigationTitle}` : ''}
        ${settings.eleventyNavigationOrder ? `order: ${settings.eleventyNavigationOrder}` : ''}
        ${settings.eleventyNavigationParent ? `parent: ${settings.eleventyNavigationParent}` : ''}
        ${settings.eleventyNavigationUrl ? `url: ${settings.eleventyNavigationUrl}` : ''}
      ` : ''}
      ---\n
    `
    // Render the body states
    const body = page.getMainComponent()
    const pagination = getState(body, 'pagination', true)
    let bodyStatesLiquid = ''
    if (pagination?.expression.length > 0) {
      //const block = getLiquidBlock(body, pagination.expression)
      const bodyId = getPersistantId(body)
      if (bodyId) {
        bodyStatesLiquid = dedent`
          {% assign ${getStateName(bodyId, 'pagination')} = pagination %}
          {% assign ${getStateName(bodyId, 'items')} = pagination.items %}
          {% assign ${getStateName(bodyId, 'pages')} = pagination.pages %}
        `
      } else {
        console.error('body has no persistant ID => do not add liquid for 11ty data')
      }
    }
    
    // Render the HTML
    pageData.content = frontMatter + bodyStatesLiquid + pageData.content

    // Create the data file for this page
    const query = editor.DataSourceManager.getPageQuery(page)
    // Remove empty data source queries
    Object.entries(query).forEach(([key, value]) => {
      if (value.length === 0) {
        delete query[key]
      }
    })
    if(Object.keys(query).length > 0) {
      // There is a query in this page
      data.files?.push({
        type: 'other',
        path: transformPath(editor, `/${slugify(page.getName() || 'index')}.11tydata.js`, 'other'),
        //path: `/${page.getName() || 'index'}.11tydata.js`,
        content: getDataFile(editor, page, query, options),
      })
    }
  })
}

/**
 * Generate the data file for a given page
 */
function getDataFile(editor: DataSourceEditor, page: Page, query: Record<string, string>, options: EleventyPluginOptions): string {
  const content = Object.entries(query).map(([dataSourceId, queryStr]) => {
    const dataSource = editor.DataSourceManager.get(dataSourceId)
    if (dataSource) {
      return queryToDataFile(dataSource, queryStr, options)
    } else {
      console.error('No data source for id', dataSourceId)
      throw new Error(`No data source for id ${dataSourceId}`)
    }
  }).join('\n')
  return `
const EleventyFetch = require('@11ty/eleventy-fetch')
module.exports = async function () {
  const result = {}
  ${content}
  return result
}
  `
}

/**
 * Generate the fetch call for a given page
 */
function queryToDataFile(dataSource: IDataSourceModel, queryStr: string, options: EleventyPluginOptions): string {
  if (dataSource.get('type') !== 'graphql') {
    console.info('not graphql', dataSource)
    return ''
  }
  const s2s = dataSource.get('serverToServer')
  const url = s2s ? s2s.url : dataSource.get('url')
  const method = s2s ? s2s.method : dataSource.get('method')
  const headers = s2s ? s2s.headers : dataSource.get('headers')
  const headersStr = headers ? Object.entries(headers).map(([key, value]) => `'${key}': '${value}'`).join('\n') : ''
  return `
  result['${dataSource.id}'] = (await EleventyFetch('${url}', {
    type: 'json',
    ${options.fetchPlugin ? `...${JSON.stringify(options.fetchPlugin)},` : ''}
    fetchOptions: {
      headers: {
        'content-type': 'application/json',
        ${headersStr}
      },
      method: '${method}',
      body: JSON.stringify({
        query: \`${queryStr}\`,
      })
    }
  })).data
`
}

/**
 * Render the components when they are published
 */
export function renderComponent(component: Component, toHtml: () => string): string | undefined {
  const statesIds = getStateIds(component, false)
  const statesArr = statesIds
    .map(stateId => ({
      stateId,
      state: getState(component, stateId, false),
    }))
    .concat(getStateIds(component, true).map(stateId => ({
      stateId,
      state: getState(component, stateId, true),
    })))
    .filter(({ state }) => state.expression.length > 0)
  // Convenience key value object
  const statesObj = statesArr
    .reduce((final, { stateId, state }) => ({
      ...final,
      [stateId]: state,
    }), {} as Record<string, StoredState>)

  if (statesArr.length) {
    const tagName = component.get('tagName')
    if (tagName) {
      const className = component.getClasses().join(' ')
        + (statesObj.className && statesObj.className?.expression.length ? ` ${echoBlock(component, statesObj.className.expression)}` : '')
      // Initial attributes
      const attributes = Object.entries(component.get('attributes') as object).map(([key, value]) => makeAttribute(key, value)).join(' ')
        // Attributes from attributes state
        + (statesObj.attributes && statesObj.attributes?.expression.length ? ` ${echoBlock(component, statesObj.attributes.expression)}` : '')
        // SRC state
        + (statesObj.src && statesObj.src?.expression.length ? ` src="${echoBlock(component, statesObj.src.expression)}"` : '')
        // HREF state
        + (statesObj.href && statesObj.href?.expression.length ? ` href="${echoBlock(component, statesObj.href.expression)}"` : '')
        // Title state
        + (statesObj.title && statesObj.title?.expression.length ? ` title="${echoBlock(component, statesObj.title.expression)}"` : '')
      const style = Object.entries(component.getStyle()).map(([key, value]) => makeStyle(key, value)).join(' ')
        + (statesObj.style && statesObj.style?.expression.length ? ` ${echoBlock(component, statesObj.style.expression)}` : '')
      const innerHtml = statesObj.innerHTML && statesObj.innerHTML?.expression.length ? echoBlock(component, statesObj.innerHTML.expression) : toHtml()
      const [ifStart, ifEnd] = statesObj.condition?.expression.length ? ifBlock(component, statesObj.condition.expression) : []
      const [forStart, forEnd] = statesObj.__data?.expression.length ? loopBlock('__data', component, statesObj.__data.expression) : []
      const before = (ifStart ?? '') + (forStart ?? '')
      const after = (ifEnd ?? '') + (forEnd ?? '')
      return `${before}<${tagName}${attributes ? ` ${attributes}` : ''}${className ? ` class="${className}"` : ''}${style ? ` style="${style}"` : ''}>${innerHtml}</${tagName}>${after}`
    } else {
      // Not a real component
      // FIXME: understand why
      throw new Error('Why no tagName?')
    }
  } else {
    return toHtml()
  }
}