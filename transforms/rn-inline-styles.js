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
    .filter(isStyle)
    .forEach(function(attrPath) {
      const element = attrPath.parent

      j(attrPath)
        .find(j.ObjectExpression)
        .filter(notSubObject)
        .forEach(function(objPath) {
          const parentType = objPath.parent.value.type

          try {
            saveRef(objPath, element)
          } catch (err) {
            const { valid, invalid } = splitStyles2(objPath)
            if (valid.properties.length > 0) {
              saveRef(valid, element)

              if (parentType === 'ArrayExpression') {
                j(objPath).replaceWith(invalid)
                objPath.parent.value.elements.push(valid)
              } else {
                const styleArray = j.arrayExpression([invalid, valid])
                j(objPath).replaceWith(styleArray)
              }
            }
          }
        })
    })
    .toSource()

  const finalSource = j(source)
    .find(j.JSXAttribute)
    .filter(isStyle)
    .forEach(function(path) {
      j(path)
        .find(j.ObjectExpression)
        .filter(notSubObject)
        .forEach(path => saveStyle(path))
    })
    .toSource()

  const fixedStyleSource = getFixedStylesSource()

  return `${finalSource}
${fixedStyleSource}
  `
}

/**
 * Helpers
 */

function getStyleId(data) {
  const { nodeName, count } = data
  const reused = count > 1
  const name = _.camelCase(data.nodeName || 'node') + (reused ? 'Common' : '')

  let idCount = (styleIds[name] || 0) + 1
  styleIds[name] = idCount

  const commonCount = reused ? `_x${count}` : ''
  const id = `${name}${idCount}${commonCount}`

  return id
}

/**
 *
 * @param {*} source
 */

function parseObject(source) {
  return eval(`(${source})`)
}

/**
 *
 * @param {*} j
 * @param {*} obj
 */

function parseObjectExpression(obj) {
  const properties = _.map(obj, (val, key) => {
    return j.property('init', j.identifier(key), j.literal(val))
  })

  return j.objectExpression(properties)
}

/**
 *
 * @param {*} styleString
 */

function splitStyles2(path) {
  const valid = []
  const invalid = []

  path.node.properties.forEach(property => {
    if (property.value.type === 'Literal') {
      valid.push(property)
    } else {
      invalid.push(property)
    }
  })

  return {
    valid: j.objectExpression(valid),
    invalid: j.objectExpression(invalid),
  }
}

/**
 *
 * @param {*} tag
 * @param {*} content
 */

function saveRef(path, element) {
  const nodeName = element.value.name.name
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
 * @param {*} styleSource
 */

function getRef(styleSource) {
  const styleObj = parseObject(styleSource)
  return hash(styleObj)
}

function createObjectExpression(source) {
  return j(`(${source})`)
    .find(j.ObjectExpression)
    .nodes()[0]
}

function isStyle(path) {
  const attrName = path.value.name.name
  return attrName === 'style'
}

function notSubObject(path) {
  const parentType = path.parent.value.type

  return parentType !== 'Property'
}

function saveStyle(path) {
  const styleSource = j(path).toSource()

  try {
    const ref = getRef(styleSource)
    const data = objects[ref]
    const id = getStyleId(data)
    data.id = id
    console.log('id', id)
    finalStyles[id] = data.style

    j(path).replaceWith(j.identifier(`${STYLES_OBJECT_VAR_NAME}.${id}`))
  } catch (err) {}
}

function getFixedStylesSource() {
  const styles = JSON.stringify(finalStyles, null, 2)

  return prettier.format(`const ${STYLES_OBJECT_VAR_NAME} = StyleSheet.create(${styles})`, {
    parser: 'babylon',
  })
}
