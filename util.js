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
      if (!_.isEqual(x, v)) {
        throw new Error(`${x} noToEqual ${v}`)
      }
    },
    toBe(v) {
      if (x !== v) {
        throw new Error(`${x} noToBe ${v}`)
      }
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

