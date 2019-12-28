import {cyan, red} from 'chalk';
import * as program from 'commander'
import * as dgram from 'dgram'
import * as fs from 'fs';
import * as sdp from 'sdp-transform'

let prog = new program.Command();

prog.option('-i, --interface <interface>', 'listen on this interface');
prog.option('-d, --out-dir <output directory>', 'put sdp files here');

function _BV(bit: number)
{
    return 1 << bit
}

function stringToAddr(addr: string)
{
    let arr = Buffer.alloc(4);

    let vals = addr.split('.').map(v => Number.parseInt(v));

    if (vals.length != 4 || vals.filter(v => v > 255).length)
        throw new Error('Not a valid ipv4 address string');

    for (let i in vals) arr.writeUInt8(vals[i], Number.parseInt(i));

    return arr.readUInt32LE(0);
}

function addrToString(addr: number)
{
    let arr = new ArrayBuffer(4);

    let v = new DataView(arr);

    v.setUint32(0, addr);

    return `${v.getUint8(3)}.${v.getUint8(2)}.${v.getUint8(1)}.${
        v.getUint8(0)}`;
}

prog.parse(process.argv);

enum SAPHeaderBits {
    VERSION_0  = _BV(5),
    ADDR_TYPE  = _BV(4),
    RESERVED   = _BV(3),
    MSG_TYPE   = _BV(2),
    ENCRYPTED  = _BV(1),
    COMPRESSED = _BV(0)
}

const receiverSocket = dgram.createSocket('udp4');

receiverSocket.on('message', data => {
    
    let header   = data.readUInt8(0);

    let options = {
        addr_type : (header & SAPHeaderBits.ADDR_TYPE) == SAPHeaderBits.ADDR_TYPE,
        msg_type : (header & SAPHeaderBits.MSG_TYPE) == SAPHeaderBits.MSG_TYPE,
        encypted : (header & SAPHeaderBits.ENCRYPTED) == SAPHeaderBits.ENCRYPTED,
        compressed : (header & SAPHeaderBits.COMPRESSED) == SAPHeaderBits.COMPRESSED,
        auth_len : data.readUInt8(1),
        msg_id_hash : data.readUInt16LE(2)
    };

    if (options.encypted || options.compressed)
        return console.log('Could not decode received message');

    let source_addr = data.readUInt32LE(4);

    let payload_type_len = data.indexOf(0, 6);
    let payload_type     = data.slice(6, payload_type_len);
    let payload          = data.slice(6 + payload_type_len, data.length);

    let sdp_obj = <any>sdp.parse(payload.toString());

    let sdptitle = `${options.msg_id_hash + source_addr}_${
        (sdp_obj.keywords)
            ? sdp_obj.keywords + '_'
            : ''}${sdp_obj.name.replace(/\s/g, '').replace(/:/g, '_')}`;


    let out_file = `${(prog.outDir) ? prog.outDir + '/' : ''}${sdptitle}.sdp`;

    console.log(`Received SAP Message ${
        options.msg_type ? '[RMV]' : '[ADD]'} ${cyan(sdptitle)} from ${
        cyan(addrToString(source_addr))}`);

    if (options.msg_type) {
        if (fs.existsSync(out_file)) fs.unlinkSync(out_file);
    }
    else
        fs.writeFileSync(out_file, payload);
})

receiverSocket.on('error', error => {
    console.log(error);
});

console.log('Binding...');

receiverSocket.bind(9875, () => {
    console.log('Bound')
    console.log(`Add multicast membership to ${cyan('239.255.255.255')}`);
    receiverSocket.addMembership('239.255.255.255', prog.interface);
});
