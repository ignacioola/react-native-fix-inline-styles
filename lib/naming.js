const _ = require('lodash')

const Strategies = {
  concatKeyValue: (key, value) => {
    return _.camelCase(key) + _.upperFirst(_.camelCase(value))
  },

  justKey: key => {
    return _.camelCase(key)
  },

  justValue: (key, value) => {
    let val = value
    if (_.isArray(value)) {
      val = value[0]
      if (!val) {
        return Strategies.justKey(key)
      }
    }

    return _.camelCase(value)
  },

  color: (key, value) => {
    if (value.includes('#') || value.includes('(')) {
      return Strategies.justKey(key, value)
    }

    return Strategies.concatKeyValue(key, value)
  },
}

/**
 *
 */

const STYLE_NAMING_FN = {
  direction: Strategies.concatKeyValue,
  textAlign: Strategies.concatKeyValue,
  fontWeight: Strategies.concatKeyValue,
  color: Strategies.color,
  backgroundColor: Strategies.color,
  marginTop: 'margin',
  marginVertical: 'margin',
  marginHorizontal: 'margin',
  marginBottom: 'margin',
  marginLeft: 'margin',
  marginRight: 'margin',
  paddingTop: 'padding',
  paddingVertical: 'padding',
  paddingHorizontal: 'padding',
  paddingBottom: 'padding',
  paddingLeft: 'padding',
  paddingRight: 'padding',
  flexDirection: Strategies.concatKeyValue,
  justifyContent: Strategies.justValue,
  alignItems: Strategies.concatKeyValue,
  position: Strategies.justValue,
  fontFamily: Strategies.justValue,
  fontStyle: Strategies.concatKeyValue,
  textDecorationLine: (key, value) => {
    if (value === 'none') {
      return Strategies.concatKeyValue(key, value)
    }

    return Strategies.justValue(key, value)
  },
  textDecorationStyle: Strategies.justValue,
  textDecorationColor: Strategies.color,
  textShadowColor: Strategies.color,
  fontVariant: Strategies.concatKeyValue,
  textTransform: (key, value) => {
    if (value === 'none') {
      return Strategies.concatKeyValue(key, value)
    }

    return Strategies.justValue(key, value)
  },
  default: Strategies.justKey,
}

/**
 *
 * @param {*} styleInfo
 */

function generateStyleName(styleInfo) {
  const { style, count } = styleInfo

  if (hasSingleProperty(style)) {
    const key = _.keys(style)[0]
    const value = style[key]
    const fn = STYLE_NAMING_FN[key] || STYLE_NAMING_FN.default

    return typeof fn === 'string' ? fn : fn(key, value)
  }

  const openingElements = Object.keys(styleInfo.openingElements || {})

  const elementCount = openingElements.length
  if (elementCount === 1) {
    if (count > 1) {
      return _.camelCase(openingElements[0]) + 'Common'
    } else {
      return _.camelCase(openingElements[0])
    }
  } else if (elementCount > 1) {
    return 'common'
  } else {
    return 'style'
  }
}

/**
 * Helpers
 */

const hasSingleProperty = obj => _.size(obj) === 1

/**
 * Exports
 */

module.exports = { generateStyleName }
