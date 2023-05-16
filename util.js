function logClone(x, ...rest){
  console.log(...rest, _.cloneDeep(x ?? {}))
}

function expect(x) {
  let errorMessage = null
  if (typeof x === 'function') {
    try{
      x()
    }catch(e) {
      errorMessage = e
    }
  }
  return {
    toEqual(v) {
      if (!_.isEqual(x, v) && JSON.stringify(x) !== JSON.stringify(v)) {
        throw new Error(`${JSON.stringify(x)} noToEqual ${JSON.stringify(v)}`)
      }
    },
    toBe(v) {
      if (x !== v) {
        throw new Error(`${x} noToBe ${v}`)
      }
    },
    toBeTruthy() {
      return Boolean(x)
    },
    not: {
      toThrow(e) {
        const err = new Error(e)
        if (!_.isEqual(err, errorMessage)) {
          throw new Error('错误不匹配', err, errorMessage)
        }
      }
    }
  }
}

Reflect.defineProperty(expect, 'assertions', {
  value: (x) =>{
     // todo 不知道干什么用的
  }
})

function getFuncName(_callee) {
  var _text = _callee.toString();
  const m = _text.match(/^function\s*(.*?)\s*\(/)
  return m ? m[1] : null;
}


function supressConsole(block) {
  const messages = []
  const { warn, error } = console
  Object.assign(console, {
      warn(e) {
          messages.push("<STDOUT> " + e)
      },
      error(e) {
          messages.push("<STDERR> " + e)
      }
  })
  try {
      block()
  } finally {
      Object.assign(console, { warn, error })
  }
  return messages
}

function grabConsole(block) {
  return supressConsole(block).join("\n")
}

const utils = {
  grabConsole,
}

