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

module.exports = function(file, api) {
  j = api.jscodeshift
  let source

  // Split styles
  source = j(file.source)
    .find(j.JSXExpressionContainer)
    .filter(hasStyleParent)
    .forEach(splitStyleExpression)
    .toSource()

  // Save references
  source = j(source)
    .find(j.JSXExpressionContainer)
    .filter(hasStyleParent)
    .find(j.ObjectExpression)
    .filter(isFirstLevelObject)
    .forEach(saveRef)
    .toSource()

  // Fix styles
  source = j(source)
    .find(j.JSXExpressionContainer)
    .filter(hasStyleParent)
    .find(j.ObjectExpression)
    .filter(isFirstLevelObject)
    .forEach(fixStyle)
    .toSource()

  const styleSource = getFixedStylesSource()

  return `${source}\n${styleSource}\n`
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
 * Save a reference and metadata for a given style
 */

function saveRef(path) {
  const openingElement = j(path)
    .closest(j.JSXOpeningElement)
    .get(0)
  const nodeName = openingElement.node.name.name

  try {
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
  } catch (err) {}
}

/**
 * Get a reference for the source object of a style
 */

function getRef(styleSource) {
  const styleObj = parseObject(styleSource)
  return hash(styleObj)
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

/**
 *
 */

function splitStyleExpression(path) {
  const styles = path.node.expression
  const isArray = styles.type === 'ArrayExpression'
  const isObject = styles.type === 'ObjectExpression'

  let newStyles = []
  if (isArray) {
    newStyles = _.flatten(styles.elements.map(splitStyleObject))
  } else if (isObject) {
    newStyles = splitStyleObject(styles)
  } else {
    return
  }

  const count = newStyles.length

  let replaceContent
  if (count > 1) {
    replaceContent = j.arrayExpression(newStyles)
  } else if (count === 1) {
    replaceContent = newStyles[0]
  }

  if (!replaceContent) {
    return
  }

  j(path)
    .find(isArray ? j.ArrayExpression : j.ObjectExpression)
    .filter(isJSXExpressionContent)
    .replaceWith(replaceContent)
}

/**
 * Splits a style at a path between the properties that are serializable
 * and the one that access variables
 */

function splitStyleObject(node) {
  const clean = []
  const dirty = []
  const conditions = []

  const { properties } = node

  if (node.type !== 'ObjectExpression') {
    return [node]
  }

  for (let property of properties) {
    const {
      key,
      value: { type },
    } = property

    switch (type) {
      case 'Literal':
        clean.push(property)
        break
      case 'ConditionalExpression':
        const cond = parseCondition(property)
        if (cond) {
          conditions.push(cond)
          break
        }
      default:
        dirty.push(property)
    }
  }

  return [
    !_.isEmpty(clean) && j.objectExpression(clean),
    ...conditions,
    !_.isEmpty(dirty) && j.objectExpression(dirty),
  ].filter(v => v)
}

/**
 *
 * @param {*} path
 */

const hasStyleParent = path => {
  try {
    const isStyle = path.parent.node.name.name === 'style'
    return isStyle
  } catch (err) {
    return false
  }
}

/**
 *
 * @param {*} property
 */

function parseCondition(property) {
  const { key, value } = property
  const { test, consequent, alternate } = value
  const isValidCond = consequent.type === 'Literal' || alternate.type === 'Literal'

  if (!isValidCond) {
    return null
  }

  const cq = j.objectExpression([j.property('init', key, consequent)])
  const al = j.objectExpression([j.property('init', key, alternate)])
  return j.conditionalExpression(test, cq, al)
}

/**
 * j
 */

const isJSXExpressionContent = path => path.parent.value.type === 'JSXExpressionContainer'
