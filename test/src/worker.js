import expect from 'expect.js';
import sinon from 'sinon';
import moment from 'moment';
import { noop } from 'lodash';
import Worker from '../../lib/worker';
import elasticsearchMock from '../fixtures/elasticsearch';
import { JOB_STATUS_PROCESSING } from '../../lib/helpers/constants';

const anchor = '2016-04-02T01:02:03.456'; // saturday
const defaults = {
  timeout: 10000,
  interval: 1500,
  size: 10,
};

describe('Worker class', function () {
  let anchorMoment;
  let clock;
  let client;
  let mockQueue;

  beforeEach(function () {
    anchorMoment = moment(anchor);
    clock = sinon.useFakeTimers(anchorMoment.valueOf());
    client = new elasticsearchMock.Client();
    mockQueue = {
      client: client
    };
  });

  afterEach(function () {
    clock.restore();
  });

  describe('invalid construction', function () {
    it('should throw without a type', function () {
      const init = () => new Worker(mockQueue);
      expect(init).to.throwException(/type.+string/i);
    });

    it('should throw without an invalid type', function () {
      const init = () => new Worker(mockQueue, { string: false });
      expect(init).to.throwException(/type.+string/i);
    });

    it('should throw without a worker', function () {
      const init = () => new Worker(mockQueue, 'test');
      expect(init).to.throwException(/worker.+function/i);
    });

    it('should throw with an invalid worker', function () {
      const init = () => new Worker(mockQueue, 'test', { function: false });
      expect(init).to.throwException(/worker.+function/i);
    });
  });

  describe('construction', function () {
    it('should have a unique ID', function () {
      var worker = new Worker(mockQueue, 'test', noop);
      expect(worker.id).to.be.a('string');

      var worker2 = new Worker(mockQueue, 'test', noop);
      expect(worker2.id).to.be.a('string');

      expect(worker.id).to.not.equal(worker2.id);
    });
  });

  describe('searching for jobs', function () {
    it('should start polling for jobs after interval', function () {
      const searchSpy = sinon.spy(mockQueue.client, 'search');
      new Worker(mockQueue, 'test', noop);
      sinon.assert.notCalled(searchSpy);
      clock.tick(defaults.interval);
      sinon.assert.calledOnce(searchSpy);
    });

    it('should use interval option to control polling', function () {
      const interval = 567;
      const searchSpy = sinon.spy(mockQueue.client, 'search');
      new Worker(mockQueue, 'test', noop, { interval });
      sinon.assert.notCalled(searchSpy);
      clock.tick(interval);
      sinon.assert.calledOnce(searchSpy);
    });

    it('should use default size', function () {
      const searchSpy = sinon.spy(mockQueue.client, 'search');
      new Worker(mockQueue, 'test', noop);
      clock.tick(defaults.interval);
      const body = searchSpy.firstCall.args[0].body;
      expect(body).to.have.property('size', defaults.size);
    });

    it('should observe the size option', function () {
      const size = 25;
      const searchSpy = sinon.spy(mockQueue.client, 'search');
      new Worker(mockQueue, 'test', noop, { size });
      clock.tick(defaults.interval);
      const body = searchSpy.firstCall.args[0].body;
      expect(body).to.have.property('size', size);
    });
  });

  describe('claiming a job', function () {
    let params;
    let job;
    let worker;
    let updateSpy;

    beforeEach(function () {
      params = {
        index: 'myIndex',
        type: 'test',
        id: 12345,
        version: 3
      };
      job = mockQueue.client.get(params);
      worker = new Worker(mockQueue, 'test', noop);
      updateSpy = sinon.spy(mockQueue.client, 'update');
    });

    it('should use version on update', function () {
      worker._claimJob(job);
      const query = updateSpy.firstCall.args[0];
      expect(query).to.have.property('index', job._index);
      expect(query).to.have.property('type', job._type);
      expect(query).to.have.property('id', job._id);
      expect(query).to.have.property('version', job._version);
    });

    it('should increment the attempts', function () {
      worker._claimJob(job);
      const doc = updateSpy.firstCall.args[0].body.doc;
      expect(doc).to.have.property('attempts', job._source.attempts + 1);
    });

    it('should update the job status', function () {
      worker._claimJob(job);
      const doc = updateSpy.firstCall.args[0].body.doc;
      expect(doc).to.have.property('status', JOB_STATUS_PROCESSING);
    });

    it('should set expiration time', function () {
      worker._claimJob(job);
      const doc = updateSpy.firstCall.args[0].body.doc;
      const expiration = anchorMoment.add(defaults.timeout).toISOString();
      expect(doc).to.have.property('process_expiration', expiration);
    });
  });

});
