const list = []
// 收集测试单元
function test(name, cb) {
  list.push([name, cb])
}


test("action should wrap in transaction", () => {
  const values = []

  const observable = mobx.observable.box(0)
  mobx.autorun(() => values.push(observable.get()))

  const increment = mobx.action("increment", amount => {
      observable.set(observable.get() + amount * 2)
      observable.set(observable.get() - amount) // oops
  })

  expect(mobx.isAction(increment)).toBe(true)
  expect(mobx.isAction(function () {})).toBe(false)

  increment(7)

  expect(values).toEqual([0, 7])
})

test("action modifications should be picked up 1", () => {
  const a = mobx.observable.box(1)
  let i = 3
  let b = 0

  mobx.autorun(() => {
      b = a.get() * 2
  })

  expect(b).toBe(2)

  const action = mobx.action(() => {
      a.set(++i)
  })

  action()
  expect(b).toBe(8)

  action()
  expect(b).toBe(10)
})

test("action modifications should be picked up 2", () => {
  const a = mobx.observable.box(1)
  let b = 0

  mobx.autorun(() => {
      b = a.get() * 2
  })

  expect(b).toBe(2)

  const action = mobx.action(() => {
      a.set(a.get() + 1) // ha, no loop!
  })

  action()
  expect(b).toBe(4)

  action()
  expect(b).toBe(6)
})

test("action modifications should be picked up 3", () => {
  const a = mobx.observable.box(1)
  let b = 0

  const doubler = mobx.computed(() => {
   return a.get() * 2
  })

  mobx.observe(
      doubler,
      () => {
          b = doubler.get()
      },
      true
  )

  expect(b).toBe(2)

  const action = mobx.action(() => {
      a.set(a.get() + 1) // ha, no loop!
  })
  
  action()
  expect(b).toBe(4)

  action()
  expect(b).toBe(6)

  a.set(a.get() + 1)
  expect(b).toBe(8)
})


test("test action should be untracked", () => {
  const a = mobx.observable.box(3)
  const b = mobx.observable.box(4)
  let latest = 0
  let runs = 0

  const action = mobx.action(baseValue => {
      b.set(baseValue * 2)
      latest = b.get() // without action this would trigger loop
  })

  const d = mobx.autorun(() => {
      runs++
      const current = a.get()
      action(current)
  })

  expect(b.get()).toBe(6)
  expect(latest).toBe(6)
  // console.log('---1---')
  a.set(7)
  expect(b.get()).toBe(14)
  expect(latest).toBe(14)
  // console.log('--2----')

  a.set(8)
  // console.log('---3---')
  expect(b.get()).toBe(16)
  expect(latest).toBe(16)

  // console.log('---4---')

  b.set(7) // should have no effect
  expect(a.get()).toBe(8)
  expect(b.get()).toBe(7)
  expect(latest).toBe(16) // effect not triggered

  a.set(3)
  expect(b.get()).toBe(6)
  expect(latest).toBe(6)

  expect(runs).toBe(4)

  d()
})


test("should be possible to create autorun in action", () => {
  const a = mobx.observable.box(1)
  const values = []

  const adder = mobx.action(inc => {
      return mobx.autorun(() => {
          values.push(a.get() + inc)
      })
  })

  const d1 = adder(2)
  a.set(3)
  const d2 = adder(17)
  a.set(24)
  d1()
  a.set(11)
  d2()
  a.set(100)

  expect(values).toEqual([3, 5, 20, 26, 41, 28]) // n.b. order could swap as autorun creation order doesn't guarantee stuff
})


// todo 不知道jest测的是啥
// test("should be possible to change unobserved state in an action called from computed", () => {
//   const a = mobx.observable.box(2)

//   const testAction = mobx.action(() => {
//       a.set(3)
//   })

//   const c = mobx.computed(() => {
//       testAction()
//   })

//   expect.assertions(1)
//   mobx.autorun(() => {
//       expect(() => {
//           c.get()
//       }).not.toThrow(/bla/)
//   })

//   mobx._resetGlobalState()
// })


// todo 过于离谱，内存快照都出来了。。
// test("should be possible to change observed state in an action called from computed", () => {
//   const a = mobx.observable.box(2)
//   const d = mobx.autorun(() => {
//       a.get()
//   })

//   const testAction = mobx.action(() => {
//       a.set(5) // this is fine
//       expect(a.get()).toBe(5)
//   })

//   const c = mobx.computed(() => {
//       expect(
//           utils.grabConsole(() => {
//               a.set(4)
//           })
//       ).toMatchInlineSnapshot(
//           `"<STDOUT> [MobX] Side effects like changing state are not allowed at this point. Are you trying to modify state from, for example, a computed value or the render function of a React component? You can wrap side effects in 'runInAction' (or decorate functions with 'action') if needed. Tried to modify: ObservableValue@19"`
//       )
//       expect(a.get()).toBe(4)
//       testAction()
//       return a.get()
//   })

//   expect(c.get()).toBe(5)

//   mobx._resetGlobalState()
//   d()
// })


test("should be possible to change observed state in an action called from computed", () => {
  const a = mobx.observable.box(2)
  const d = mobx.autorun(() => {
      a.get()
  })

  const testAction = mobx.action(() => {
      a.set(3)
  })

  const c = mobx.computed(() => {
      testAction()
      return a.get()
  })

  expect(
      utils.grabConsole(() => {
          c.get()
      })
  ).toBe("")

  mobx._resetGlobalState()
  d()
})


test("action in autorun should be untracked", () => {
  const a = mobx.observable.box(2)
  const b = mobx.observable.box(3)

  const data = []
  const multiplier = mobx.action(val => val * b.get())

  const d = mobx.autorun(() => {
      data.push(multiplier(a.get()))
  })

  a.set(3)
  b.set(4)
  a.set(5)

  d()

  a.set(6)

  expect(data).toEqual([6, 9, 20])
})


test("action should not be converted to computed when using (extend)observable", () => {
  const a = mobx.observable({
      a: 1,
      b: mobx.action(function () {
          this.a++
      })
  })

  expect(mobx.isAction(a.b)).toBe(true)
  a.b()
  expect(a.a).toBe(2)

  mobx.extendObservable(a, {
      c: mobx.action(function () {
          this.a *= 3
      })
  })

  expect(mobx.isAction(a.c)).toBe(true)
  a.c()
  expect(a.a).toBe(6)
})


test("#286 exceptions in actions should not affect global state", () => {
  let autorunTimes = 0
  function Todos() {
      this.id = 1
      mobx.extendObservable(this, {
          count: 0,
          add: mobx.action(function () {
              this.count++
              // console.log(this, this.count);
              if (this.count === 2) {
                  throw new Error("An Action Error!")
              }
          })
      })
  }
  const todo = new Todos()
  mobx.autorun(() => {
      autorunTimes++
      return todo.count
  })
  try {
      todo.add()
      expect(autorunTimes).toBe(2)
      todo.add()
  } catch (e) {
      expect(autorunTimes).toBe(3)
      todo.add()
      expect(autorunTimes).toBe(4)
  }
})


test("runInAction", () => {
  mobx.configure({ enforceActions: "always" })
  const values = []
  const events = []
  const spyDisposer = mobx.spy(ev => {
      if (ev.type === "action")
          events.push({
              name: ev.name,
              arguments: ev.arguments
          })
  })

  const observable = mobx.observable.box(0)
  const d = mobx.autorun(() => values.push(observable.get()))

  let res = mobx.runInAction(() => {
      observable.set(observable.get() + 6 * 2)
      observable.set(observable.get() - 3) // oops
      return 2
  })

  expect(res).toBe(2)
  expect(values).toEqual([0, 9])

  res = mobx.runInAction(() => {
      observable.set(observable.get() + 5 * 2)
      observable.set(observable.get() - 4) // oops
      return 3
  })

  expect(res).toBe(3)
  expect(values).toEqual([0, 9, 15])
  expect(events).toEqual([
      { arguments: [], name: "<unnamed action>" },
      { arguments: [], name: "<unnamed action>" }
  ])

  mobx.configure({ enforceActions: "never" })
  spyDisposer()

  d()
})

test("autorun 嵌套，延迟执行", () => {
  const arr = []
  mobx.runInAction(() => {
    arr.push(-1)
    mobx.autorun(() => {
      arr.push(1)
      mobx.autorun(() => {
        arr.push(5)
      })
      arr.push(2);
      mobx.runInAction(() => {
        arr.push(3)
      })
      mobx.autorun(() => {
        arr.push(6)
      })
      mobx.runInAction(() => {
        arr.push(4)
      })
    })
    arr.push(0)
  })
  expect(arr).toEqual([-1, 0, 1,2,3,4,5,6])
})

test('self case', () => {
  const a = mobx.observable.box(1)
  let b = 0

  const doubler = mobx.computed(() => {
   return a.get() * 2
  })

  const d =  mobx.observe(
      doubler,
      () => {
          b = doubler.get()
      },
      true
  )

  mobx.observe(
      doubler,
       function listener() {
          b = doubler.get()
      },
      false
  )

  expect(b).toBe(2)

  const action = mobx.action(() => {
      a.set(a.get() + 1) // ha, no loop!
  })
  // console.log('--start--', doubler.value.observing.size)
  action()
  expect(b).toBe(4)
  // console.log('d before')
  d()
  // console.log('--end--', doubler.value.observing.size)
  action()
  expect(b).toBe(6)
})

test("action in autorun doesn't keep/make computed values alive", () => {
  let calls = 0
  const myComputed = mobx.computed(() => {
    // console.log('---computed--------')
    return calls++
  })
  const callComputedTwice = () => {
      myComputed.get()
      myComputed.get()
  }

  const runWithMemoizing = fun => {
    // 这里dispose了
      mobx.autorun(fun)()
  }

  callComputedTwice()
  expect(calls).toBe(2)
  // console.log('外层非嵌套不走缓存')
  runWithMemoizing(callComputedTwice)
  // console.log('如果在autorun里第一次不走缓存，后续走缓存');
  expect(calls).toBe(3)

  callComputedTwice()
  // console.log('前面虽然在autorun里监听了，但是已经dispose了，所以不走缓存')
  expect(calls).toBe(5)
  runWithMemoizing(function () {
      mobx.runInAction(callComputedTwice)
  })
  // console.log('如果在action里第一次不走缓存，后续走缓存');
  expect(calls).toBe(6)

  // console.log('---start-----', myComputed)
  callComputedTwice()
  // 通过了
  expect(calls).toBe(8)
})

test("action in autorun doesn't keep/make computed values alive 2", () => {
  let calls = 0
  const myComputed = mobx.computed(() => {
    // console.log('---computed--------')
    return calls++
  })
  const callComputedTwice = () => {
      myComputed.get()
      myComputed.get()
  }

  const runWithMemoizing = fun => {
    // 这里dispose了
    return mobx.autorun(fun)
  }

  callComputedTwice()
  expect(calls).toBe(2)
  // console.log('外层非嵌套不走缓存')
  const d = runWithMemoizing(callComputedTwice)
  // console.log('如果在autorun里第一次不走缓存，后续走缓存');
  expect(calls).toBe(3)

  callComputedTwice()
  // console.log('前面虽然在autorun里监听了，但是已经dispose了，所以不走缓存')
  expect(calls).toBe(3)
  d()
  runWithMemoizing(function () {
      mobx.runInAction(callComputedTwice)
  })()
  // console.log('如果在action里第一次不走缓存，后续走缓存');
  expect(calls).toBe(4)

  // console.log('---start-----', myComputed)
  callComputedTwice()
  // 通过了
  expect(calls).toBe(6)
})

test("action in autorun doesn't keep/make computed values alive 3", () => {
  let calls = 0
  const myComputed = mobx.computed(() => {
    const t = calls
    // console.log('computed-> last:{' + myComputed.value_ + '},current:{' + t + '}')
    return calls++
  })
  const callComputedTwice = () => {
    // 在最外层环境下，只有第一次不走缓存。
    const value = myComputed.get()
    // console.log('---1--', value)
    const value2 = myComputed.get()
    // console.log('---2--', value2)
    // 这里验证了，action外面如果是（autorun，或者action），走缓存
    mobx.runInAction(() => {
      const value3 = myComputed.get()
      // console.log('---3--', value3)
    })
  }

  const runWithMemoizing = fun => {
    // console.log('runWithMemoizing')
    mobx.autorun(fun)();
  }

  // callComputedTwice()
  // console.log('a', calls)
  // expect(calls).toBe(2)
  // runWithMemoizing(callComputedTwice)
  // console.log('b', calls)


  // callComputedTwice()

  // console.log('c', calls, globalState.isInAction, globalState.trackingReaction)
  myComputed.get()
  expect(calls).toBe(1)
  // console.log('b1')
  let d
  mobx.autorun(() => {
      // console.log('autorun4')
      myComputed.get()
      expect(calls).toBe(2)
      // console.log('get before5')
      myComputed.get()

     d = mobx.autorun(() => {
        // console.log('autorun4')
        myComputed.get()
        // console.log('get before5')
        myComputed.get()
      });
    })();
    expect(calls).toBe(2)
  // console.log('b2')
   mobx.autorun(() => {
      // console.log('autorun2')
      myComputed.get()
      // console.log('get before3')
      myComputed.get()
      mobx.runInAction(() => {
        callComputedTwice()
        mobx.runInAction(() => {
          callComputedTwice()
        });
      });
    })();
    expect(calls).toBe(2)
    // console.log('c1');
    d()
    mobx.runInAction(callComputedTwice);
    expect(calls).toBe(3)
    // console.log('d1')
    // console.log('debugger')
   const d2 = mobx.autorun(callComputedTwice)
    expect(calls).toBe(4)
    // console.log('c2');
    myComputed.get();
    expect(calls).toBe(4)
    // console.log('c3');
    d2()
    myComputed.get();
    expect(calls).toBe(5)
    // console.log('c4');
    const d3 =  mobx.autorun(() => {
      // console.log('autorun')
      myComputed.get()
      // console.log('get before')
      myComputed.get()

    })
    expect(calls).toBe(6)
    // console.log('c5');
   mobx.runInAction(callComputedTwice);
    expect(calls).toBe(6)
    // console.log('c6');
    myComputed.get();
    expect(calls).toBe(6)

    runWithMemoizing(callComputedTwice)
    expect(calls).toBe(6)
    // console.log('c7');
    d3()
    myComputed.get();
    expect(calls).toBe(7)
    // console.log('c8');


  // runWithMemoizing(function () {

  //  })
  // console.log('d', calls)
  // callComputedTwice()
  // console.log('e', calls)
  // callComputedTwice()
})

test("computed values and actions", () => {
  let calls = 0

  const number = mobx.observable.box(1)
  const squared = mobx.computed(() => {
      calls++
      // console.log('computed')
      return number.get() * number.get()
  })
  const changeNumber10Times = mobx.action(() => {
      squared.get()
      // console.log('run1')
      squared.get()
      // console.log('run2')
      for (let i = 0; i < 10; i++){
        const v = number.get()
        number.set(v + 1)
      }
  })

  changeNumber10Times()
  expect(calls).toBe(1)

  mobx.autorun(() => {

      changeNumber10Times()

      expect(calls).toBe(2)
  })()
  expect(calls).toBe(2)

  changeNumber10Times()
  expect(calls).toBe(3)
})

test('----computed-----', () => {
  const a = mobx.observable.box(1)
  const b = mobx.observable.box(2)
  let calls = 0
  const c = mobx.computed(() => {
   return a.get() + b.get()
  })
  let ans = []
  mobx.autorun(() => {
    const v = c.get()
    calls++;
    ans.push(v)
  })

  expect(calls).toBe(1)
  expect(ans).toEqual([3])

  // a.set(2)
  // b.set(2)
  mobx.runInAction(() => {
    a.set(2)
    b.set(6)
  })
  expect(calls).toBe(2)
  expect(ans).toEqual([3, 8])
  b.set(1)
  expect(calls).toBe(3)
  expect(ans).toEqual([3, 8, 3])
  mobx.runInAction(() => {
    a.set(1)
    b.set(2)
  })
  expect(calls).toBe(3)
  expect(ans).toEqual([3, 8, 3])
})


let topTestCase = false;
const toggleBtn = document.getElementById('toggleBtn')
const debuggerBtn = document.getElementById('debuggerBtn');
function run () {
  mobx._resetGlobalState();
  try{
    // 这里执行
    list.slice(topTestCase ? -1: 0).map(([name, cb]) => {
      console.log('-------' + name + '-------')
      cb()
    })
  }catch(e) {
    console.error(e)
  }
  toggleBtn.innerHTML = topTestCase ? '当前最新，点击测试全部' : '当前全部，点击测试最新'
  debuggerBtn.innerHTML = !mobx.globalState.logger ? '当前隐藏，点击展示log' : '当前展示，点击隐藏log'
}
run();

if (toggleBtn instanceof HTMLButtonElement) {
  toggleBtn.onclick = () => {
    topTestCase = !topTestCase
    console.clear();
    run()
  }
}

if (debuggerBtn instanceof HTMLButtonElement) {
  debuggerBtn.onclick = () => {
    mobx.globalState.logger = !mobx.globalState.logger;
    console.clear();
    run()
  }
}
