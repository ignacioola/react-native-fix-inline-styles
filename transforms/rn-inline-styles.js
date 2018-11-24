const hash = require('object-hash')
const prettier = require('prettier')
const _ = require('lodash')
const naming = require('../lib/naming')

/**
 * Global ref
 */

let j

/**
 * Stored info
 */

const objects = {}
const finalStyles = {}
const usedStylesByName = {}

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

  const root = j(file.source)

  // Save already fixed styles
  root
    .find(j.VariableDeclarator)
    .find(j.Identifier, { name: 'fixedStyles' })
    .forEach(savedAlreadyFixedStyles)

  // Remove already fixed styles in order to re-generate them
  root
    .find(j.VariableDeclarator)
    .find(j.Identifier, { name: 'fixedStyles' })
    .closest(j.VariableDeclaration)
    .remove()

  // Split clean and dirty styles
  root
    .find(j.JSXExpressionContainer)
    .filter(hasStyleParent)
    .forEach(splitStyleExpression)

  // Save references from clean styles
  root
    .find(j.JSXExpressionContainer)
    .filter(hasStyleParent)
    .find(j.ObjectExpression)
    .filter(isFirstLevelObject)
    .forEach(saveRefFromPath)
    .toSource()

  // Replace clean styles with stylesheet references
  source = root
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

function generateStyleId(data) {
  const { count, id } = data

  if (id != null) {
    return id
  }

  const common = count > 1
  const name = naming.generateStyleName(data)

  if (!usedStylesByName[name]) {
    usedStylesByName[name] = 0
  }

  const nextIdIndex = ++usedStylesByName[name]
  const generatedId = `${name}${nextIdIndex === 1 ? '' : nextIdIndex - 1}`

  while (finalStyles[generatedId]) {
    return generateStyleId(data)
  }

  return generatedId
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

function saveRefFromPath(path) {
  const openingElement = j(path)
    .closest(j.JSXOpeningElement)
    .get(0)
  const openingElementName = openingElement.node.name.name

  const styleSource = j(path).toSource()
  saveRefFromStyle(styleSource, { openingElementName })
}

/**
 * Saves a reference for a processed clean style
 */

function saveRefFromStyle(styleSource, { openingElementName, id }) {
  try {
    const styleObj = parseObject(styleSource)
    const ref = hash(styleObj)

    if (!objects[ref]) {
      objects[ref] = {
        ref,
        style: styleObj,
        source: styleSource,
        openingElementName,
        id,
        count: 1,
      }
    } else {
      objects[ref].count++
    }

    if (id != null) {
      addFinalStyle(id, styleObj)
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
 * Apply the fix to a style at a path
 */

function fixStyle(path) {
  const styleSource = j(path).toSource()

  try {
    const ref = getRef(styleSource)
    const data = objects[ref]
    const id = generateStyleId(data)
    data.id = id
    addFinalStyle(id, data.style)

    j(path).replaceWith(j.identifier(`${STYLES_OBJECT_VAR_NAME}.${id}`))
  } catch (err) {}
}

/**
 * Adds a style to the final fixed styles object
 */

function addFinalStyle(id, styleObj) {
  finalStyles[id] = styleObj
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
 * Splits the inner styles of a style expression into clean and dirty styles
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
 * Saves fixed styles that existed before running this transform
 */

function savedAlreadyFixedStyles(path) {
  const declaration = path.parent
  const fixedStylePath = j(path.parent).find(j.ObjectExpression)

  if (fixedStylePath.length === 0) {
    return
  }

  const styles = fixedStylePath.get()

  styles.node.properties.forEach(property => {
    const styleSource = j(property.value).toSource()
    saveRefFromStyle(styleSource, { id: property.key.name })
  })
}

/**
 * Receives a property with a conditional expression inside and converts it
 * into a conditional expression which return style objects
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
 * Filters
 */

const hasStyleParent = path => _.get(path, 'parent.node.name.name') === 'style'
const isFirstLevelObject = path => _.get(path, 'parent.value.type') !== 'Property'
const isJSXExpressionContent = path => _.get(path, 'parent.value.type') === 'JSXExpressionContainer'
