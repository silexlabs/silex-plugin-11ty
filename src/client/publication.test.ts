/*
 * @jest-environment jsdom
 */

import dedent from 'dedent'
import {expect, jest, test} from '@jest/globals'
import { buildAttributes, getFrontMatter, isAttribute, queryToDataFile } from './publication'
import DataSource from './DataSource'
import { IDataSourceModel } from '@silexlabs/grapesjs-data-source'
import { Page } from 'grapesjs'
//import grapesjs, { Page } from 'grapesjs'
//import { DataSourceEditor, DataSourceEditorOptions, getState } from '@silexlabs/grapesjs-data-source'
//
//const mockGetState = jest.fn()
//jest.mock('@silexlabs/grapesjs-data-source', () => {
//  return {
//    getState: jest.fn(() => mockGetState),
//  }
//})

// Prevent lit-html from being imported
// This is because it breakes the tests since lit-html is a peer dependency (?)
jest.mock('lit-html', () => ({}))

test('Front matter of a simple page', () => {
  expect(() => getFrontMatter({}, 'page-1', '')).not.toThrow()
  expect(getFrontMatter({}, 'page-1', '')).toEqual(dedent`
  ---
  permalink: "/page-1/index.html"
  \n---\n`)
})

test('Front matter of a collection page', () => {
  const settings = {
    eleventyPageData: 'directus.posts',
  }
  expect(() => getFrontMatter(settings, 'page-1', 'collectionTest')).not.toThrow()
  expect(getFrontMatter(settings, 'page-1', 'collectionTest')).toEqual(dedent`
  ---
  pagination:
    data: directus.posts
  collection: "collectionTest"
  \n---\n`)
})

test('Permalink', () => {
  const eleventyPageData = 'directus.posts'
  const eleventyPermalink = '/test/{{ permalink[0] }}-with-special-chars/'
  const settings = {
    eleventyPageData,
    eleventyPermalink,
  }
  expect(() => getFrontMatter(settings, 'page-1', '')).not.toThrow()
  expect(getFrontMatter(settings, 'page-1', '')).toEqual(dedent`
  ---
  pagination:
    data: ${eleventyPageData}
  permalink: "${eleventyPermalink}"
  \n---\n`)
})

test('With languages', () => {
  const settings = {
    eleventyPageData: 'directus.posts',
    silexLanguagesList: 'fr,en',
    silexLanguagesDefault: 'en',
  }
  expect(() => getFrontMatter(settings, 'page-1', '', 'fr')).not.toThrow()
  expect(getFrontMatter(settings, 'page-1', '', 'fr')).toEqual(dedent`
  ---
  pagination:
    data: directus.posts
  lang: "fr"
  \n---\n`)
})

test('isAttribute', () => {
  expect(isAttribute('data-attribute')).toBe(true)
  expect(isAttribute('href')).toBe(true)
  expect(isAttribute('innerHTML')).toBe(false)
  expect(isAttribute('')).toBe(false)
})

test('buildAttributes', () => {
  const attributes = buildAttributes({
    'href': 'original-value',
    'class': 'original-value',
  }, [{
    stateId: 'href-id',
    label: 'href',
    value: 'new-value',
  },{
    stateId: 'class-id',
    label: 'class',
    value: 'new-value',
  }])
  expect(attributes).toEqual('href="new-value" class="original-value new-value"')
})

test('getDataFile', () => {
  const editor = {
    get: jest.fn((name) => {
      switch (name) {
        case 'type': return 'graphql'
        case 'serverToServer': return {
          url: 'http://localhost:8055',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
        }
      }
      throw new Error(`Unit test error, unknown name: ${name}`)
    }),
  } as unknown as IDataSourceModel
  const page = {
    getName: () => 'page name example',
    getId: () => 'page id example',
  } as unknown as Page
  const query = 'query str example'
  const result1 = queryToDataFile(
    editor,
    query,
    {
      cacheBuster: false,
      dataSources: [],
      view: {},
      filters: [],
      fetchPlugin: {},
    },
    page,
    'fr',
  )
  // check that we have as much { as } in the result
  expect(result1.split('{').length).toBe(result1.split('}').length)
  expect(result1.split('(').length).toBe(result1.split(')').length)
  expect(result1).toContain('EleventyFetch(')
  const result2 = queryToDataFile(
    editor,
    query,
    {
      cacheBuster: false,
      dataSources: [],
      view: {},
      filters: [],
      fetchPlugin: false,
    },
    page,
    'fr',
  )
  expect(result2).not.toContain('EleventyFetch')
  // check that we have as much { as } in the result
  expect(result2.split('{').length).toBe(result2.split('}').length)
  expect(result2.split('(').length).toBe(result2.split(')').length)
  const result3 = queryToDataFile(
    editor,
    query,
    {
      cacheBuster: false,
      dataSources: [],
      view: {},
      filters: [],
    },
    page,
    'fr',
  )
  expect(result3).not.toContain('EleventyFetch')
})
