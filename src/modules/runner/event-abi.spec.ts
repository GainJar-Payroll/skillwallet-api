import { parseTriggerEventAbi } from './event-abi'

describe('parseTriggerEventAbi', () => {
  it('parses a signature without the event prefix', () => {
    const abiEvent = parseTriggerEventAbi('Transfer(address indexed from,address indexed to,uint256 value)')

    expect(abiEvent.type).toBe('event')
    expect(abiEvent.name).toBe('Transfer')
  })

  it('parses a signature that already has the event prefix', () => {
    const abiEvent = parseTriggerEventAbi('event Approval(address indexed owner,address indexed spender,uint256 value)')

    expect(abiEvent.type).toBe('event')
    expect(abiEvent.name).toBe('Approval')
  })

  it('throws when neither parse attempt produces an event', () => {
    expect(() => parseTriggerEventAbi('function Transfer(address,address) returns (bool)')).toThrow(/Unable to parse event signature/)
  })
})
