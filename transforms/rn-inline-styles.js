const hash = require('object-hash')
const prettier = require('prettier')
const _ = require('lodash')

/**
 * Global ref
 */

let j

/**
 * Stored info
 */

const objects = {}
const styleIds = {}
const finalStyles = {}
const usedIdsByNode = {}

/**
 * Constants
 */

const STYLES_OBJECT_VAR_NAME = 'fixedStyles'

/**
 * Main
 */

module.exports = function(fileInfo, api) {
  j = api.jscodeshift
  const attributes = j(fileInfo.source).find(j.JSXAttribute)

  let source = attributes
    .filter(isStyleAttribute)
    .forEach(function(attrPath) {
      const jsxNode = attrPath.parent

      j(attrPath)
        .find(j.ObjectExpression)
        .filter(isFirstLevelObject)
        .forEach(function(objPath) {
          try {
            saveRef(objPath, jsxNode)
          } catch (err) {
            const { parsed, notParsed } = splitStyles(objPath)

            if (parsed.properties.length > 0) {
              saveRef(parsed, jsxNode)
              modifyStyle(objPath, [notParsed, parsed])
            }
          }
        })
    })
    .toSource()

  const finalSource = j(source)
    .find(j.JSXAttribute)
    .filter(isStyleAttribute)
    .forEach(function(path) {
      j(path)
        .find(j.ObjectExpression)
        .filter(isFirstLevelObject)
        .forEach(path => fixStyle(path))
    })
    .toSource()

  const fixedStyleSource = getFixedStylesSource()

  return `${finalSource}
${fixedStyleSource}
  `
}

/**
 * Returns the id for a style
 */

function getStyleId(data) {
  const { ref, nodeName, count } = data
  const reused = count > 1
  const name = _.camelCase(nodeName || 'node') + (reused ? 'Common' : '')

  if (!usedIdsByNode[name]) {
    usedIdsByNode[name] = 0
  }

  usedIdsByNode[name]++

  const nextIdIndex = usedIdsByNode[name]
  const commonCount = reused ? `_x${count}` : ''
  const id = `${name}${nextIdIndex}${commonCount}`

  return id
}

/**
 * Parse an object from it's source string
 */

function parseObject(source) {
  return eval(`(${source})`)
}

/**
 * Splits a style at a path between the properties that are serializable and the one that access variables
 */

function splitStyles(path) {
  const parsed = []
  const notParsed = []

  path.node.properties.forEach(property => {
    if (property.value.type === 'Literal') {
      parsed.push(property)
    } else {
      try {
        eval(j(property.value).toSource())
        parsed.push(property)
      } catch (err) {
        notParsed.push(property)
      }
    }
  })

  return {
    parsed: j.objectExpression(parsed),
    notParsed: j.objectExpression(notParsed),
  }
}

/**
 *
 * @param {*} path
 * @param {*} jsxNode
 */

function modifyStyle(objPath, styles) {
  const parentType = objPath.parent.value.type

  if (parentType === 'ArrayExpression') {
    const [first, ...rest] = styles
    j(objPath).replaceWith(first)
    objPath.parent.value.elements.concat(rest)
  } else {
    const styleArray = j.arrayExpression(styles)
    j(objPath).replaceWith(styleArray)
  }
}

/**
 * Save a reference and metadata for a given style
 */

function saveRef(path, jsxNode) {
  const nodeName = jsxNode.value.name.name
  const styleSource = j(path).toSource()
  const styleObj = parseObject(styleSource)
  const ref = hash(styleObj)

  if (!objects[ref]) {
    objects[ref] = {
      ref,
      style: styleObj,
      source: styleSource,
      nodeName,
      count: 1,
    }
  } else {
    objects[ref].count++
  }

  return ref
}

/**
 * Get a reference for the source object of a style
 */

function getRef(styleSource) {
  const styleObj = parseObject(styleSource)
  return hash(styleObj)
}

/**
 * Check if a node is a style attribute
 */

function isStyleAttribute(path) {
  const attrName = path.value.name.name
  return attrName === 'style'
}

/**
 * Check if an object is nested within another object
 */

function isFirstLevelObject(path) {
  const parentType = path.parent.value.type

  return parentType !== 'Property'
}

/**
 * Apply the fix to a style at a path
 */

function fixStyle(path) {
  const styleSource = j(path).toSource()

  try {
    const ref = getRef(styleSource)
    const data = objects[ref]
    const id = getStyleId(data)
    data.id = id
    finalStyles[id] = data.style

    j(path).replaceWith(j.identifier(`${STYLES_OBJECT_VAR_NAME}.${id}`))
  } catch (err) {}
}

/**
 * Get the final source to append fixed styles
 */

function getFixedStylesSource() {
  const styles = JSON.stringify(finalStyles, null, 2)

  return prettier.format(`const ${STYLES_OBJECT_VAR_NAME} = StyleSheet.create(${styles})`, {
    parser: 'babylon',
    singleQuote: true,
    trailingComma: 'es5',
  })
}
