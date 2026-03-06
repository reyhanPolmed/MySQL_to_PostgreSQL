#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const MySQLToPostgresConverter = require('./converter.js');

if (process.argv.length < 3) {
    console.log('Usage: node cli.js <input.sql> [output.sql]');
    process.exit(1);
}

const inputFile = process.argv[2];
const outputFile = process.argv[3] || 'postgresql_converted.sql';

try {
    console.log(`Reading SQL from ${inputFile}...`);
    const sql = fs.readFileSync(path.resolve(inputFile), 'utf8');
    
    console.log(`Converting...`);
    const converter = new MySQLToPostgresConverter({
        dropIfExists: true,
        createSequences: true,
        convertCharset: true,
        convertEngine: true,
        convertBackticks: true,
        convertComments: true
    });
    
    const result = converter.convert(sql);
    
    fs.writeFileSync(path.resolve(outputFile), result);
    
    console.log(`\nConversion complete!`);
    console.log(`- Tables converted: ${converter.stats.tablesConverted}`);
    console.log(`- Inserts converted: ${converter.stats.insertsConverted}`);
    console.log(`- Data type conversions: ${converter.stats.dataTypesChanged}`);
    console.log(`\nSaved PostgreSQL SQL to ${outputFile}`);
    
} catch (err) {
    if (err.code === 'ENOENT') {
        console.error(`Error: Could not find input file: ${inputFile}`);
    } else {
        console.error(`Error during conversion:`, err.message);
    }
    process.exit(1);
}
